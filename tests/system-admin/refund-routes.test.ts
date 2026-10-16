import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

// Keep the real limiter, headers, key generator and route wiring; replace only Redis storage.
jest.unstable_mockModule("rate-limit-redis", async () => {
  const { MemoryStore } = await import("express-rate-limit");
  return { RedisStore: class extends MemoryStore { constructor() { super(); } } };
});
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: {} }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ invalidateCache: jest.fn() }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { REFUND_RATE_LIMIT_WINDOW_MS: 60000, REFUND_RATE_LIMIT_MAX: 2 } }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (token: string) => ({ sub: token, sessionVersion: 0 }) }));
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: {
  user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
    id: where.id, email: "test@example.invalid", firstName: "Test", lastName: "Operator", status: "ACTIVE", deletedAt: null,
    platformRole: where.id === "tenant" ? "NONE" : "SYSTEM_ADMIN", securityStatus: "ACTIVE", sessionVersion: 0,
    organizationId: where.id === "tenant" ? "org-a" : null,
    organization: { id: "org-a", status: "ACTIVE", billingEnabled: false },
    role: { name: "Admin", organizationId: "org-a", deletedAt: null, permissions: [] }, userPermissions: [],
  })) },
} }));
const service = {
  requestRefund: jest.fn(async () => ({ status: "REQUESTED" })),
  reviewRefund: jest.fn(async () => ({ status: "APPROVED" })),
  refundPayment: jest.fn(async () => ({ status: "COMPLETED" })),
};
jest.unstable_mockModule("@/modules/system-admin/billing.service.js", () => ({ billingService: service }));
const { default: routes } = await import("@/modules/system-admin/billing.routes.js");
const { authenticate } = await import("@/middleware/auth.js");
const { requireSystemAdmin } = await import("@/middleware/require-platform-admin.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/billing", authenticate, requireSystemAdmin, routes);
app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);
const mutation = { reason: "Confirmed refund operation", confirm: true };
const stages = [
  { path: "refund-requests", body: { ...mutation, evidence: "customer-request:A", idempotencyKey: "request-key-a" }, method: "requestRefund", status: 201 },
  { path: "refund-review", body: { ...mutation, requestId: "request-a", decision: "APPROVED" }, method: "reviewRefund", status: 200 },
  { path: "refund", body: { ...mutation, requestId: "request-a", evidence: "bank-return:A", idempotencyKey: "refund-key-a" }, method: "refundPayment", status: 200 },
] as const;

beforeEach(() => jest.clearAllMocks());
test.each(stages)("$path requires authentication and rejects tenant administrators", async ({ path, body, method }) => {
  expect((await request(app).post(`/billing/payments/payment-a/${path}`).send(body)).status).toBe(401);
  expect((await request(app).post(`/billing/payments/payment-a/${path}`).auth("tenant", { type: "bearer" }).send(body)).status).toBe(403);
  expect(service[method]).not.toHaveBeenCalled();
});
test.each(stages)("$path enforces the configured per-operator limit and Retry-After", async ({ path, body, method, status }) => {
  const send = (actor: string) => request(app).post(`/billing/payments/payment-a/${path}`).auth(actor, { type: "bearer" }).send(body);
  for (let index = 0; index < 2; index++) expect((await send(`operator-${path}`)).status).toBe(status);
  const blocked = await send(`operator-${path}`);
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  expect(service[method]).toHaveBeenCalledTimes(2);
  expect((await send(`another-${path}`)).status).toBe(status);
});
