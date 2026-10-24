import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { MemoryStore } from "express-rate-limit";
import { rateLimitEnvironmentSchema } from "../../src/config/rate-limit.js";

const pending: Promise<unknown>[] = [];
const waitUntil = jest.fn((task: Promise<unknown>) => { pending.push(task); });
const create = jest.fn(async (args: unknown) => args);
const findMany = jest.fn(async () => [{ ip: "203.0.113.42", country: "PH" }]);
const count = jest.fn(async () => 1);
const groupBy = jest.fn(async () => [{ ip: "203.0.113.42", _count: { _all: 7 }, _max: { createdAt: new Date() } }]);
const deleteMany = jest.fn(async (_args: unknown) => ({ count: 1 }));
jest.unstable_mockModule("@vercel/functions", () => ({ waitUntil }));
jest.unstable_mockModule("rate-limit-redis", () => ({ RedisStore: class extends MemoryStore { constructor() { super(); } } }));
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: {}, redisReady: async () => {} }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: {
  ...rateLimitEnvironmentSchema.parse({}), APP_ENV: "test", API_RATE_LIMIT_MAX: 2,
  CRON_SECRET: "cron-secret-for-test-only", INTERNAL_API_SECRET: "internal-secret-for-test-only",
} }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (sub: string) => ({ sub, sessionVersion: 0 }) }));
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: {
  accessLog: { create, findMany, count, groupBy, deleteMany },
  $transaction: (tasks: Promise<unknown>[]) => Promise.all(tasks),
  user: { findUnique: async ({ where }: { where: { id: string } }) => ({
    id: where.id, status: "ACTIVE", deletedAt: null, securityStatus: "ACTIVE", sessionVersion: 0,
    platformRole: where.id === "tenant" ? "NONE" : "SYSTEM_ADMIN",
    organizationId: where.id === "tenant" ? "org-a" : null,
    organization: { id: "org-a", status: "ACTIVE", billingEnabled: false },
    role: { name: "Admin", organizationId: "org-a", deletedAt: null, permissions: [] }, userPermissions: [],
  }) },
} }));
const { accessLogger } = await import("@/middleware/access-logger.js");
const { accessLogRoutes, accessLogCronRoutes } = await import("@/modules/access-logs/access-logs.routes.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const app = express();
app.set("trust proxy", true);
app.use(accessLogger, withRequestContext);
app.use("/api/admin/access-logs", accessLogRoutes);
app.use("/api/cron", accessLogCronRoutes);
app.use((_req, res) => { res.sendStatus(200); });
app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);

beforeEach(async () => { await Promise.all(pending.splice(0)); jest.clearAllMocks(); });
afterEach(async () => { await Promise.all(pending.splice(0)); });

test("captures only allowed metadata with Express proxy trust and decoded city", async () => {
  await request(app).post("/visit?token=do-not-store").set("x-vercel-forwarded-for", "203.0.113.42")
    .set("x-real-ip", "192.0.2.2").set("x-forwarded-for", "192.0.2.3, 192.0.2.4")
    .set("x-vercel-ip-country", "PH").set("x-vercel-ip-city", "General%20Santos")
    .set("user-agent", "Sample browser").set("authorization", "secret").set("cookie", "private=secret").send({ password: "secret" });
  await Promise.all(pending);
  expect(create).toHaveBeenCalledWith({ data: {
    ip: "192.0.2.3", method: "POST", path: "/visit", status: 200,
    durationMs: expect.any(Number), country: "PH", city: "General Santos", userAgent: "Sample browser",
  } });
  expect(waitUntil).toHaveBeenCalledTimes(1);
});

test.each([
  [{ "x-real-ip": "192.0.2.2", "x-forwarded-for": "192.0.2.3, 192.0.2.4" }, "192.0.2.3"],
  [{ "x-forwarded-for": "192.0.2.3, 192.0.2.4" }, "192.0.2.3"],
  [{ "x-client-ip": "203.0.113.9", "x-real-ip": "192.0.2.2", "x-forwarded-for": "192.0.2.3" }, "192.0.2.3"],
  [{ "x-client-ip": "203.0.113.9", "x-internal-api-secret": "wrong", "x-real-ip": "192.0.2.2", "x-forwarded-for": "192.0.2.3" }, "192.0.2.3"],
  [{ "x-client-ip": "203.0.113.9", "x-internal-api-secret": "internal-secret-for-test-only" }, "203.0.113.9"],
])("selects an IP and gates internal overrides: %j", async (headers, ip) => {
  await request(app).get("/visit").set(headers);
  await Promise.all(pending);
  expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ ip }) });
});

test("falls back to a loopback IP without forwarding headers", async () => {
  await request(app).get("/visit");
  await Promise.all(pending);
  expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ ip: expect.stringMatching(/127\.0\.0\.1|::1/) }) });
});

test("direct requests cannot forge IP attribution using forwarding headers", async () => {
  const direct = express();
  direct.set("trust proxy", 0);
  direct.use(accessLogger);
  direct.get("/visit", (_req, res) => res.sendStatus(200));
  await request(direct).get("/visit").set("x-vercel-forwarded-for", "203.0.113.9")
    .set("x-real-ip", "203.0.113.9").set("x-forwarded-for", "203.0.113.9");
  await Promise.all(pending);
  expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ ip: expect.stringMatching(/127\.0\.0\.1|::1/) }) });
});

test("one configured proxy hop uses Express's nearest untrusted address", async () => {
  const proxied = express();
  proxied.set("trust proxy", 1);
  proxied.use(accessLogger);
  proxied.get("/visit", (_req, res) => res.sendStatus(200));
  await request(proxied).get("/visit").set("x-vercel-forwarded-for", "203.0.113.9")
    .set("x-real-ip", "203.0.113.9").set("x-forwarded-for", "192.0.2.3, 192.0.2.4");
  await Promise.all(pending);
  expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ ip: "192.0.2.4" }) });
});

test("truncates columns and tolerates a malformed encoded city", async () => {
  await request(app).get(`/${"x".repeat(600)}`).set("user-agent", "a".repeat(400)).set("x-vercel-ip-city", "%invalid");
  await Promise.all(pending);
  expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ path: `/${"x".repeat(499)}`, userAgent: "a".repeat(300), city: "%invalid" }) });
});

test.each(["/favicon.ico", "/api/health", "/api/admin/other", "/api/system-admin/monitoring", "/api/cron/access-logs"])("skips %s", async (path) => {
  await request(app).get(path);
  expect(create).not.toHaveBeenCalled();
});

test("database and waitUntil failures never affect the response", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    create.mockRejectedValueOnce(new Error("private-database-details"));
    expect((await request(app).get("/visit")).status).toBe(200);
    await Promise.all(pending);
    waitUntil.mockImplementationOnce(() => { throw new Error("no context"); });
    expect((await request(app).get("/visit")).status).toBe(200);
    expect(error.mock.calls.flat().join(" ")).not.toContain("private-database-details");
  } finally { error.mockRestore(); }
});

test.each(["", "/top-ips"])("rejects anonymous and tenant administrators for %s", async (path) => {
  expect((await request(app).get(`/api/admin/access-logs${path}`)).status).toBe(401);
  expect((await request(app).get(`/api/admin/access-logs${path}`).auth("tenant", { type: "bearer" })).status).toBe(403);
  expect(findMany).not.toHaveBeenCalled();
  expect(groupBy).not.toHaveBeenCalled();
});

test("validates pagination, caps the limit and applies exact IP filtering", async () => {
  const response = await request(app).get("/api/admin/access-logs?page=2&limit=999&ip=203.0.113.42").auth("pagination", { type: "bearer" });
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.body.data.pagination).toMatchObject({ page: 2, pageSize: 200 });
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ip: "203.0.113.42" }, skip: 200, take: 200 }));
  expect((await request(app).get("/api/admin/access-logs?page=-1").auth("invalid", { type: "bearer" })).status).toBe(400);
  expect((await request(app).get("/api/admin/access-logs?ip=bad").auth("invalid", { type: "bearer" })).status).toBe(400);
});

test("returns top IPs with a rolling 24-hour window", async () => {
  const response = await request(app).get("/api/admin/access-logs/top-ips").auth("top", { type: "bearer" });
  expect(response.status).toBe(200);
  expect(response.body.data[0]).toMatchObject({ ip: "203.0.113.42", country: "PH", hitCount: 7, lastSeen: expect.any(String) });
  expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["ip"], take: 20, where: { createdAt: { gte: expect.any(Date) } } }));
});

test("admin reads retain real middleware limits and Retry-After", async () => {
  const send = () => request(app).get("/api/admin/access-logs").auth("rate-limit", { type: "bearer" });
  expect((await send()).status).toBe(200);
  expect((await send()).status).toBe(200);
  const response = await send();
  expect(response.status).toBe(429);
  expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
});

test("cron requires its bearer secret and deletes only rows older than 30 days", async () => {
  expect((await request(app).get("/api/cron/access-logs")).status).toBe(401);
  expect((await request(app).get("/api/cron/access-logs").auth("wrong", { type: "bearer" })).status).toBe(401);
  expect(deleteMany).not.toHaveBeenCalled();
  expect((await request(app).get("/api/cron/access-logs").auth("cron-secret-for-test-only", { type: "bearer" })).status).toBe(200);
  const cutoff = deleteMany.mock.calls[0]?.[0] as unknown as { where: { createdAt: { lt: Date } } };
  expect(Math.abs(cutoff.where.createdAt.lt.getTime() - (Date.now() - 30 * 86400_000))).toBeLessThan(2000);
});
