import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { MemoryStore } from "express-rate-limit";
import { rateLimitEnvironmentSchema } from "../../src/config/rate-limit.js";

const result = { id: "a".repeat(64), mode: "DEMO", invitationStatus: "SENT" };
const service = {
  templates: jest.fn(async () => ({ templates: [{ id: "AIRCON" }] })),
  template: jest.fn(async (_id: string) => ({ template: { id: "AIRCON", version: 1 } })),
  create: jest.fn(async (_body: unknown) => result), get: jest.fn(async (_id: string) => result),
  resendInvitation: jest.fn(async (_id: string, _body: unknown) => result), resetDemo: jest.fn(async (_id: string, _body: unknown) => result),
};
jest.unstable_mockModule("@/modules/system-admin/provisioning/provisioning.service", () => ({ provisioningService: service }));
jest.unstable_mockModule("@/config/env", () => ({ env: { ...rateLimitEnvironmentSchema.parse({}), APP_ENV: "test", WRITE_RATE_LIMIT_MAX: 1, WRITE_RATE_LIMIT_WINDOW_MS: 60_000 } }));
jest.unstable_mockModule("@/lib/rate-limit-store", () => ({ RecoverableRateLimitStore: class extends MemoryStore { constructor() { super(); } } }));
jest.unstable_mockModule("@/utils/cache", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn() }));
jest.unstable_mockModule("@/utils/tokens", () => ({ verifyAccessToken: (token: string) => ({ sub: token, sessionVersion: 0, platformRole: "SYSTEM_ADMIN" }) }));
jest.unstable_mockModule("@/lib/prisma", () => ({ prisma: { user: { findUnique: async ({ where }: { where: { id: string } }) => ({
  id: where.id, firstName: "Route", lastName: "User", email: "route@example.test", deletedAt: null,
  status: "ACTIVE", securityStatus: "ACTIVE", sessionVersion: 0, organizationId: where.id.startsWith("platform") ? null : "tenant-org",
  platformRole: where.id.startsWith("platform") ? "SYSTEM_ADMIN" : "NONE",
  organization: where.id.startsWith("platform") ? null : { id: "tenant-org", slug: "tenant-org", status: "ACTIVE", billingEnabled: false },
  role: { name: "Admin", organizationId: where.id.startsWith("platform") ? null : "tenant-org", deletedAt: null, permissions: [] }, userPermissions: [],
}) } } }));
const { authenticate } = await import("@/middleware/auth.js");
const { requireSystemAdmin } = await import("@/middleware/require-platform-admin.js");
const { apiLimiter } = await import("@/middleware/rateLimiter.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { default: routes } = await import("@/modules/system-admin/provisioning/provisioning.routes.js");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/api/system-admin", authenticate, apiLimiter, requireSystemAdmin, routes);
app.use(((error, _req, res, _next) => {
  if (error.retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(error.retryAfterSeconds));
  res.status(error.statusCode ?? 500).json({ error: error.message });
}) as express.ErrorRequestHandler);
const input = {
  idempotencyKey: "9b112271-de6b-47ae-a2a6-1be4b844641e", templateId: "AIRCON", mode: "DEMO",
  organization: { name: "Demo Cooling", slug: "demo-cooling" },
  owner: { firstName: "Marina", lastName: "Santos", email: "owner@example.test" }, reason: "Reviewed demo workspace", confirm: true,
};
beforeEach(() => jest.clearAllMocks());

test("anonymous requests and tenant accounts cannot enumerate templates or provision tenants", async () => {
  expect((await request(app).get("/api/system-admin/provisioning/templates")).status).toBe(401);
  expect((await request(app).get("/api/system-admin/provisioning/templates").set("Authorization", "Bearer tenant")).status).toBe(403);
  expect((await request(app).post("/api/system-admin/provisioning").set("Authorization", "Bearer tenant").send(input)).status).toBe(403);
  expect(service.templates).not.toHaveBeenCalled(); expect(service.create).not.toHaveBeenCalled();
});

test("static templates precede identifier routes and return the standard response envelope", async () => {
  const response = await request(app).get("/api/system-admin/provisioning/templates").set("Authorization", "Bearer platform-list");
  expect(response.status).toBe(200); expect(response.body.data.templates).toEqual([{ id: "AIRCON" }]);
  expect(service.get).not.toHaveBeenCalled();
});

test("template detail enforces platform authorization and validates the industry identifier", async () => {
  expect((await request(app).get("/api/system-admin/provisioning/templates/AIRCON")).status).toBe(401);
  expect((await request(app).get("/api/system-admin/provisioning/templates/AIRCON").set("Authorization", "Bearer tenant")).status).toBe(403);
  const response = await request(app).get("/api/system-admin/provisioning/templates/AIRCON").set("Authorization", "Bearer platform-detail");
  expect(response.status).toBe(200); expect(response.body.data.template).toEqual({ id: "AIRCON", version: 1 });
  expect((await request(app).get("/api/system-admin/provisioning/templates/UNKNOWN").set("Authorization", "Bearer platform-detail")).status).toBe(400);
});

test("provisioning mutation validates privilege selectors and applies shared middleware 429 with Retry-After", async () => {
  const invalid = await request(app).post("/api/system-admin/provisioning").set("Authorization", "Bearer platform-invalid").send({ ...input, organizationId: "other" });
  expect(invalid.status).toBe(400); expect(service.create).not.toHaveBeenCalled();
  const send = () => request(app).post("/api/system-admin/provisioning").set("Authorization", "Bearer platform-write").send(input);
  expect((await send()).status).toBe(200);
  const limited = await send(); expect(limited.status).toBe(429); expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
  expect(service.create).toHaveBeenCalledTimes(1);
});

test.each(["invitation", "reset-demo"])("%s validates its action and shares the write budget", async (action) => {
  const route = `/api/system-admin/provisioning/${result.id}/${action}`;
  const body = { reason: "Reviewed operator action", confirm: true };
  const send = () => request(app).post(route).set("Authorization", `Bearer platform-${action}`).send(body);
  expect((await send()).status).toBe(200);
  const limited = await send(); expect(limited.status).toBe(429); expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
});
