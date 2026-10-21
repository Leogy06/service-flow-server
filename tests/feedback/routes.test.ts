import { jest } from "@jest/globals";
import express from "express";
import { MemoryStore } from "express-rate-limit";
import request from "supertest";
import { rateLimitEnvironmentSchema } from "../../src/config/rate-limit.js";

jest.unstable_mockModule("rate-limit-redis", () => {
  return { RedisStore: class extends MemoryStore { constructor() { super(); } } };
});
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: {}, redisReady: async () => {} }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn() }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: {
  ...rateLimitEnvironmentSchema.parse({}), APP_ENV: "test",
  FEEDBACK_RATE_LIMIT_WINDOW_MS: 60000, FEEDBACK_RATE_LIMIT_MAX: 2,
  REFUND_RATE_LIMIT_WINDOW_MS: 60000, REFUND_RATE_LIMIT_MAX: 2,
  SIGNUP_RATE_LIMIT_WINDOW_MS: 60000, SIGNUP_RATE_LIMIT_MAX: 2,
} }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (token: string) => ({ sub: token, sessionVersion: 0 }) }));
const grantNames = ["feedback:create", "feedback:read", "feedback:update", "service_request:read"];
const permission = (name: string) => ({ id: name, name, organizationId: null });
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: { user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
  const platform = where.id === "operator";
  return {
    id: where.id, email: "test@example.invalid", firstName: "Test", lastName: "Member", status: "ACTIVE", deletedAt: null,
    platformRole: platform ? "SYSTEM_ADMIN" : "NONE", securityStatus: "ACTIVE", sessionVersion: 0,
    organizationId: platform ? null : "org-a", organization: platform ? null : { id: "org-a", status: "ACTIVE", billingEnabled: false },
    role: { id: "role-a", name: "Admin", organizationId: platform ? null : "org-a", deletedAt: null,
      permissions: where.id === "staff" ? [] : grantNames.map((name) => ({ permission: permission(name) })) },
    userPermissions: where.id === "denied" ? [{ permission: permission("feedback:read"), isActive: false }] : [],
  };
}) } } }));
const service = {
  submitProduct: jest.fn(async () => ({ id: "feedback-a" })), mine: jest.fn(async () => ({ feedback: [] })),
  listProduct: jest.fn(async () => ({ feedback: [] })), listCustomer: jest.fn(async () => ({ feedback: [] })),
  reviewProduct: jest.fn(async () => ({})), reviewCustomer: jest.fn(async () => ({})),
  withdrawProduct: jest.fn(async () => ({ withdrawn: true })), createInvitation: jest.fn(async () => ({ token: "private" })),
  publicContext: jest.fn(async () => ({ businessName: "Business A", submitted: false, consentActive: false })),
  submitCustomer: jest.fn(async () => ({ submitted: true })), withdrawCustomer: jest.fn(async () => ({ withdrawn: true })),
};
jest.unstable_mockModule("@/modules/feedback/feedback.service.js", () => ({ feedbackService: service }));
const { tenantFeedbackRoutes, platformFeedbackRoutes, publicFeedbackRoutes } = await import("@/modules/feedback/feedback.routes.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { feedbackLimiter, publicWriteLimiter, writeLimmiter } = await import("@/middleware/rateLimiter.js");
const { ipKeyGenerator } = await import("express-rate-limit");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/tenant", tenantFeedbackRoutes); app.use("/platform", platformFeedbackRoutes); app.use("/public", publicFeedbackRoutes);
app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);
const token = "a".repeat(43);
const input = { rating: 4, comment: "Useful product", submissionKey: "12345678-1234-4234-8234-123456789012" };
beforeEach(async () => {
  jest.clearAllMocks();
  for (const ip of ["::ffff:127.0.0.1", "127.0.0.1", "::1"]) {
    await feedbackLimiter.resetKey(ipKeyGenerator(ip)); await publicWriteLimiter.resetKey(ipKeyGenerator(ip)); await writeLimmiter.resetKey(ipKeyGenerator(ip));
  }
  for (const id of ["staff", "tenant", "operator", "denied"]) await writeLimmiter.resetKey(`u:${id}`);
});
test.each([
  ["get", "/tenant/product/mine", {}], ["post", "/tenant/product", input],
  ["post", "/tenant/product/a/withdraw-consent", {}], ["get", "/tenant/customers", {}],
  ["patch", "/tenant/customers/a", { status: "RESOLVED" }], ["post", "/tenant/invitations", { serviceRequestId: "a" }],
  ["get", "/platform", {}], ["patch", "/platform/a", { status: "RESOLVED" }],
] as const)("%s %s requires authentication", async (method, path, body) => {
  expect((await request(app)[method](path).send(body)).status).toBe(401);
});
test("tenant administrators cannot access platform feedback; operators cannot use tenant endpoints", async () => {
  expect((await request(app).get("/platform").auth("tenant", { type: "bearer" })).status).toBe(403);
  expect((await request(app).patch("/platform/a").auth("tenant", { type: "bearer" }).send({ status: "RESOLVED" })).status).toBe(403);
  expect((await request(app).get("/tenant/product/mine").auth("operator", { type: "bearer" })).status).toBe(403);
  expect(service.listProduct).not.toHaveBeenCalled(); expect(service.reviewProduct).not.toHaveBeenCalled();
  expect((await request(app).get("/platform").auth("operator", { type: "bearer" })).status).toBe(200);
});
test("staff can send product feedback but customer access requires grants and respects deny overrides", async () => {
  expect((await request(app).post("/tenant/product").auth("staff", { type: "bearer" }).send(input)).status).toBe(200);
  for (const actor of ["staff", "denied"]) expect((await request(app).get("/tenant/customers").auth(actor, { type: "bearer" })).status).toBe(403);
  expect((await request(app).patch("/tenant/customers/a").auth("denied", { type: "bearer" }).send({ status: "RESOLVED" })).status).toBe(403);
  expect((await request(app).post("/tenant/invitations").auth("staff", { type: "bearer" }).send({ serviceRequestId: "a" })).status).toBe(403);
  expect(service.listCustomer).not.toHaveBeenCalled(); expect(service.reviewCustomer).not.toHaveBeenCalled(); expect(service.createInvitation).not.toHaveBeenCalled();
});
test("authorized customer operations validate input, forward trusted context and disable caching", async () => {
  const list = await request(app).get("/tenant/customers?organizationId=foreign").auth("tenant", { type: "bearer" });
  expect(list.status).toBe(200); expect(list.headers["cache-control"]).toBe("no-store");
  expect(service.listCustomer).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
  expect((await request(app).post("/tenant/invitations").auth("tenant", { type: "bearer" }).send({ serviceRequestId: "a", organizationId: "foreign" })).status).toBe(400);
  expect((await request(app).patch("/tenant/customers/a").auth("tenant", { type: "bearer" }).send({ comment: "rewritten" })).status).toBe(400);
  expect((await request(app).patch("/tenant/customers/a").auth("tenant", { type: "bearer" }).send({ testimonialApproved: true })).status).toBe(200);
});
test.each(["context", "submit", "withdraw-consent"])("public %s has a real configured limit and Retry-After", async (action) => {
  const body = action === "submit" ? { token, rating: 4, comment: "Good service" } : { token };
  for (let index = 0; index < 2; index++) expect((await request(app).post(`/public/${action}`).send(body)).status).toBe(200);
  const blocked = await request(app).post(`/public/${action}`).send(body);
  expect(blocked.status).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
});
test("authenticated writes use the existing write limiter", async () => {
  // Reset the authenticated user's bucket between cases; exercise the actual limit.
  for (let index = 0; index < 30; index++) expect((await request(app).post("/tenant/product/a/withdraw-consent").auth("staff", { type: "bearer" })).status).toBe(200);
  const blocked = await request(app).post("/tenant/product/a/withdraw-consent").auth("staff", { type: "bearer" });
  expect(blocked.status).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  expect(service.withdrawProduct).toHaveBeenCalledTimes(30);
});
