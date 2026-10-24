import { jest } from "@jest/globals";
import express from "express";
import { MemoryStore, type Options } from "express-rate-limit";
import request from "supertest";
import jwt from "jsonwebtoken";
import { rateLimitEnvironmentSchema } from "../../src/config/rate-limit";
import { AppError } from "../../src/utils/AppError";

const prefixes: string[] = [];
const resetStores: Array<() => Promise<void>> = [];
const shutdownStores: Array<() => void> = [];
const logger = { info: jest.fn(), error: jest.fn() };
let storeUnavailable = false;
const settings = {
  ...rateLimitEnvironmentSchema.parse({ API_RATE_LIMIT_MAX: 3, AUTH_RATE_LIMIT_MAX: 3, REFRESH_RATE_LIMIT_MAX: 3,
    PUBLIC_API_RATE_LIMIT_MAX: 3, SIGNUP_RATE_LIMIT_MAX: 3 }),
  APP_ENV: "policy-tests", NODE_ENV: "test", JWT_ACCESS_SECRET: "fixture-access-secret",
  TWO_FACTOR_SEND_MAX_PER_HOUR: 20,
  CORS_ORIGIN: "http://localhost:3000", TRUST_PROXY_HOPS: 0, TRUST_PROXY_DIAGNOSTICS: false,
};
jest.unstable_mockModule("@/config/env.js", () => ({ env: settings }));
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: {}, redisReady: async () => {} }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger }));
jest.unstable_mockModule("@/lib/prisma", () => ({ prisma: {
  user: { findFirst: async () => null },
  loginChallenge: { findUnique: async () => ({ userId: "resend-user" }) },
} }));
jest.unstable_mockModule("@/modules/auth/trusted-device.routes", () => ({ default: express.Router() }));
jest.unstable_mockModule("rate-limit-redis", () => {
  return { RedisStore: class {
    private memory = new MemoryStore();
    constructor({ prefix }: { prefix: string }) {
      prefixes.push(prefix);
      resetStores.push(async () => { this.memory.resetAll(); });
      shutdownStores.push(() => this.memory.shutdown());
    }
    async init(options: Options) { this.memory.init(options); }
    increment(key: string) {
      if (storeUnavailable) throw new Error("Fixture Redis store unavailable");
      return this.memory.increment(key);
    }
    decrement(key: string) { return this.memory.decrement(key); }
    resetKey(key: string) { return this.memory.resetKey(key); }
    get(key: string) { return this.memory.get(key); }
  } };
});

const authenticate: express.RequestHandler = (req, _res, next) => {
  const actor = req.get("Authorization")?.replace(/^Bearer /, "");
  if (!actor) return next(new AppError(401, "No token provided"));
  req.user = { id: actor, role: "Staff", firstName: "Fixture", lastName: "User", email: "fixture@example.invalid" };
  next();
};
jest.unstable_mockModule("@/middleware/auth.js", () => ({ authenticate }));
const success: express.RequestHandler = (_req, res) => { res.json({ fixture: true }); };
const logoutController = jest.fn(success);
const resource = () => express.Router().get("/", success);
// Keep the real app, root routing, auth routing, policies, CORS and error formatting.
// Only resource controllers and authentication/database work are fixtures.
for (const path of [
  "permission/permission.route", "user-permission/user.permission.routes", "role/role.routes", "customer/customer.routes",
  "service-request/service-request.routes", "job/job.routes", "invoice/invoice.routes", "role-permission/role.permission.routes",
  "user/user.routes", "organization/organization.route", "system-admin/system-admin.routes", "audit/audit.routes", "dashboard/dashboard.routes",
]) jest.unstable_mockModule(`@/modules/${path}.js`, () => ({ default: resource() }));
jest.unstable_mockModule("@/modules/feedback/feedback.routes.js", () => ({
  tenantFeedbackRoutes: resource(), platformFeedbackRoutes: resource(), publicFeedbackRoutes: resource(),
}));
jest.unstable_mockModule("@/modules/auth/auth.controller.js", () => ({ authController: {
  register: success, refresh: success, logout: logoutController, logoutAll: success, me: success, verifyTwoFactor: success,
  resendTwoFactor: (async (req, res, next) => {
    try { await (await import("@/middleware/two-factor-rate-limit")).limitTwoFactorDelivery(req, res, "login-user"); success(req, res, next); } catch (error) { next(error); }
  }) satisfies express.RequestHandler,
  login: (async (req, res, next) => {
    if (req.body.password === "incorrect") return next(new AppError(401, "Invalid credentials"));
    try { await (await import("@/middleware/two-factor-rate-limit")).limitTwoFactorDelivery(req, res, "login-user"); res.json({ fixture: true }); } catch (error) { next(error); }
  }) satisfies express.RequestHandler,
} }));
jest.unstable_mockModule("@/modules/auth/profile.controller.js", () => ({ profileController: { get: success, update: success, changePassword: success } }));
jest.unstable_mockModule("@/modules/user/user.controller.js", () => ({ userController: { setPassword: success } }));
jest.unstable_mockModule("@/middleware/request-logger.js", () => ({ requestLogger: ((_req, _res, next) => next()) satisfies express.RequestHandler }));
jest.unstable_mockModule("@/modules/system-admin/telemetry.js", () => ({
  observeRequests: ((_req, _res, next) => next()) satisfies express.RequestHandler, onPlatformServerError: jest.fn(),
}));
jest.unstable_mockModule("@/modules/system-admin/operations.service.js", () => ({ recordPlatformServerError: jest.fn() }));

const { app } = await import("../../src/app");
const { apiLimiter } = await import("../../src/middleware/rateLimiter");
const { limitTwoFactorDelivery } = await import("../../src/middleware/two-factor-rate-limit");
const { errorHandler } = await import("../../src/middleware/errorHandler");
const login = (password = "correct") => request(app).post("/api/auth/login").send({ email: "fixture@example.invalid", password });
beforeEach(async () => { storeUnavailable = false; await Promise.all(resetStores.map((reset) => reset())); jest.clearAllMocks(); });
afterAll(() => { for (const shutdown of shutdownStores) shutdown(); });

test("every store has a distinct named environment prefix", () => {
  expect(prefixes.length).toBeGreaterThan(10);
  expect(new Set(prefixes).size).toBe(prefixes.length);
  expect(prefixes.every((prefix) => prefix.startsWith("rl:policy-tests:") && prefix.endsWith(":"))).toBe(true);
  expect(prefixes).toEqual(expect.arrayContaining(["rl:policy-tests:api:", "rl:policy-tests:auth:", "rl:policy-tests:refresh:"]));
});

test("real root and auth routes apply general limits after authentication and isolate users sharing an IP", async () => {
  const paths = ["/api/customers", "/api/jobs", "/api/auth/me", "/api/customers"];
  const responses = [];
  for (const path of paths) responses.push(await request(app).get(path).auth("user-a", { type: "bearer" }));
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 429]);
  expect(responses.slice(0, 3).map((response) => response.headers["ratelimit-remaining"])).toEqual(["2", "1", "0"]);
  const other = await request(app).get("/api/customers").auth("user-b", { type: "bearer" });
  expect(other.status).toBe(200);
  expect(other.headers["ratelimit-remaining"]).toBe("2");
});

test("429 uses the shared AppError shape and exposes real retry headers through app CORS", async () => {
  for (let count = 0; count < 3; count++) await request(app).get("/api/auth/me").auth("cors-user", { type: "bearer" });
  const blocked = await request(app).get("/api/auth/me").auth("cors-user", { type: "bearer" }).set("Origin", settings.CORS_ORIGIN);
  const seconds = Number(blocked.headers["retry-after"]);
  expect(blocked.status).toBe(429);
  expect(seconds).toBeGreaterThan(0);
  expect(blocked.body).toEqual({ error: "Too many requests, please try again later.", code: "RATE_LIMITED", retryAfterSeconds: seconds });
  expect(blocked.headers["access-control-allow-origin"]).toBe(settings.CORS_ORIGIN);
  expect(blocked.headers["access-control-expose-headers"].toLowerCase()).toContain("retry-after");
  expect(blocked.headers["access-control-expose-headers"].toLowerCase()).toContain("ratelimit-remaining");
});

test("CORS OPTIONS and health do not consume a browsing bucket", async () => {
  for (let count = 0; count < 5; count++) {
    const response = await request(app).options("/api/auth/me").set("Origin", settings.CORS_ORIGIN).set("Access-Control-Request-Method", "GET");
    expect(response.status).toBe(204);
    expect(response.headers["ratelimit-remaining"]).toBeUndefined();
    expect((await request(app).get("/api/health")).status).toBe(200);
  }
  const response = await request(app).get("/api/auth/me").auth("preflight-user", { type: "bearer" });
  expect(response.headers["ratelimit-remaining"]).toBe("2");
});

test("nested monitoring skip uses originalUrl including query strings", async () => {
  const nested = express();
  const routes = express.Router();
  routes.use(authenticate, apiLimiter);
  routes.get("/monitoring", success);
  nested.use("/api/system-admin", routes);
  nested.use(errorHandler);
  for (let count = 0; count < 5; count++) {
    const response = await request(nested).get("/api/system-admin/monitoring?probe=1").auth("monitor-user", { type: "bearer" });
    expect(response.status).toBe(200);
    expect(response.headers["ratelimit-remaining"]).toBeUndefined();
  }
});

test.each(["/api/customers", "/api/auth/me", "/api/auth/profile"])("failed protected authentication on %s consumes the public abuse budget", async (path) => {
  const statuses = [];
  for (let count = 0; count < 4; count++) statuses.push((await request(app).get(path)).status);
  expect(statuses).toEqual([401, 401, 401, 429]);
  expect((await request(app).get("/api/customers").auth("authenticated", { type: "bearer" })).status).toBe(200);
});

test("successful logins and refresh cannot drain the failed-login budget", async () => {
  for (let count = 0; count < 6; count++) expect((await login()).status).toBe(200);
  for (let count = 0; count < 3; count++) expect((await request(app).post("/api/auth/refresh")).status).toBe(200);
  expect((await request(app).post("/api/auth/refresh")).status).toBe(429);
  expect((await login()).status).toBe(200);
  for (let count = 0; count < 3; count++) expect((await login("incorrect")).status).toBe(401);
  expect((await login("incorrect")).status).toBe(429);
});

test("refresh accepts only signed user identity for bucketing; arbitrary bearer strings share the IP bucket", async () => {
  for (const token of ["random-a", "random-b", "random-c"]) expect((await request(app).post("/api/auth/refresh").auth(token, { type: "bearer" })).status).toBe(200);
  expect((await request(app).post("/api/auth/refresh").auth("random-d", { type: "bearer" })).status).toBe(429);
  const expired = jwt.sign({ sub: "signed-user" }, settings.JWT_ACCESS_SECRET, { algorithm: "HS256", expiresIn: -1 });
  expect((await request(app).post("/api/auth/refresh").auth(expired, { type: "bearer" })).status).toBe(200);
  const other = jwt.sign({ sub: "signed-other" }, settings.JWT_ACCESS_SECRET, { algorithm: "HS256" });
  expect((await request(app).post("/api/auth/refresh").auth(other, { type: "bearer" })).status).toBe(200);
});

test("signup retains its own strict guard before validation without consuming login attempts", async () => {
  for (let count = 0; count < 3; count++) expect((await request(app).post("/api/auth/register").send({})).status).toBe(400);
  expect((await request(app).post("/api/auth/register").send({})).status).toBe(429);
  expect((await login()).status).toBe(200);
});

function expectClearedRefreshCookies(headers: Record<string, unknown>) {
  const cookies = headers["set-cookie"];
  expect(Array.isArray(cookies)).toBe(true);
  if (!Array.isArray(cookies)) throw new Error("Missing refresh-cookie clearing headers");
  expect(cookies).toHaveLength(2);
  expect(cookies.filter((cookie: string) => cookie.includes("Path=/api/auth;"))).toHaveLength(1);
  expect(cookies.filter((cookie: string) => cookie.includes("Path=/api/auth/refresh;"))).toHaveLength(1);
  expect(cookies.every((cookie: string) => cookie.startsWith("refreshToken=;") && cookie.includes("Expires=Thu, 01 Jan 1970"))).toBe(true);
}

test("logout clears each cookie scope exactly once even when its public budget returns 429", async () => {
  for (let count = 0; count < 3; count++) {
    const response = await request(app).post("/api/auth/logout").set("Cookie", "refreshToken=private-fixture-refresh");
    expect(response.status).toBe(200);
    expectClearedRefreshCookies(response.headers);
  }
  const blocked = await request(app).post("/api/auth/logout").set("Cookie", "refreshToken=private-fixture-refresh");
  expect(blocked.status).toBe(429);
  expectClearedRefreshCookies(blocked.headers);
  expect(logoutController).toHaveBeenCalledTimes(3);
  expect(logoutController.mock.calls[0][0].cookies.refreshToken).toBe("private-fixture-refresh");
});

test("Redis outage keeps browsing open and auth closed while logout still clears browser cookies on 503", async () => {
  storeUnavailable = true;
  const read = await request(app).get("/api/auth/me").auth("outage-user", { type: "bearer" });
  expect(read.status).toBe(200);
  expect((await login()).status).toBe(503);
  expect((await request(app).post("/api/auth/2fa/verify").send({ challengeId: "a".repeat(43), code: "1234" })).status).toBe(503);
  expect((await request(app).post("/api/auth/2fa/resend").send({ challengeId: "a".repeat(43) })).status).toBe(503);
  const blocked = await request(app).post("/api/auth/logout").set("Cookie", "refreshToken=private-fixture-refresh");
  expect(blocked.status).toBe(503);
  expectClearedRefreshCookies(blocked.headers);
  expect(logoutController).not.toHaveBeenCalled();
});

test("2FA verification has an independent IP budget and Retry-After", async () => {
  const send = () => request(app).post("/api/auth/2fa/verify").send({ challengeId: "a".repeat(43), code: "1234", rememberDevice: false });
  for (let i = 0; i < 30; i++) expect((await send()).status).toBe(200);
  const blocked = await send();
  expect(blocked.status).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  expect(blocked.body.code).toBe("RATE_LIMITED");
  expect((await request(app).get("/api/auth/me").auth("verify-limited", { type: "bearer" })).status).toBe(200);
});

test("login and resend share a strict delivery IP budget", async () => {
  for (let i = 0; i < 10; i++) expect((await login()).status).toBe(200);
  const resend = () => request(app).post("/api/auth/2fa/resend").send({ challengeId: "a".repeat(43) });
  for (let i = 0; i < 10; i++) expect((await resend()).status).toBe(200);
  const blocked = await resend(); expect(blocked.status).toBe(429);
  expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  expect((await login()).status).toBe(429);
});

test("delivery account policy uses the verified identity independently of client email and IP policy", async () => {
  const isolated = express(); isolated.use(express.json());
  isolated.post("/login", async (req, res, next) => {
    try { await limitTwoFactorDelivery(req, res, "verified-user"); success(req, res, next); } catch (error) { next(error); }
  }); isolated.use(errorHandler);
  for (let i = 0; i < 20; i++) expect((await request(isolated).post("/login").send({ email: i % 2 ? "Sample@Example.invalid" : " sample@example.invalid " })).status).toBe(200);
  const blocked = await request(isolated).post("/login").send({ email: "sample@example.invalid" });
  expect(blocked.status).toBe(429); expect(blocked.headers["retry-after"]).toBeDefined();
  expect((await request(isolated).post("/login").send({ email: "another@example.invalid" })).status).toBe(429);
});
