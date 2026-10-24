import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { createHash } from "node:crypto";
import type { Prisma } from "../../src/generated/prisma/client.js";

type Scope = Record<string, unknown>;
type Factor = {
  id: string; userId: string; organizationId: string | null; surface: string;
  tokenHash: string; userAgent: string; ipAddress: string; createdAt: Date; lastUsedAt: Date;
  expiresAt: Date; revokedAt: Date | null; consumedAt: Date | null;
};
type Query = { where: Scope; data: Partial<Factor> };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const users = [
  { id: "staff-a", organizationId: "org-a", platformRole: "NONE", sessionVersion: 0 },
  { id: "other-a", organizationId: "org-a", platformRole: "NONE", sessionVersion: 0 },
  { id: "staff-b", organizationId: "org-b", platformRole: "NONE", sessionVersion: 0 },
  { id: "platform", organizationId: null, platformRole: "SYSTEM_ADMIN", sessionVersion: 0 },
];
let devices: Factor[];
let challenges: Factor[];
let audits: Scope[];
let failAudit = false;
let limited = false;
const matches = (row: Factor, where: Scope) => Object.entries(where).every(([key, value]) => {
  const field = row[key as keyof Factor];
  if (value && typeof value === "object" && "gt" in value) return field instanceof Date && field > (value.gt as Date);
  return field === value;
});
function factor(id: string, userId = "staff-a", organizationId: string | null = "org-a", surface = "tenant"): Factor {
  return { id, userId, organizationId, surface, tokenHash: hash(id), userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0", ipAddress: "192.0.2.1", createdAt: new Date(), lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), revokedAt: null, consumedAt: null };
}
const db = {
  trustedDevice: {
    findMany: jest.fn(async ({ where }: { where: Scope }) => devices.filter((row) => matches(row, where)).map((row) => ({ ...row }))),
    findFirst: jest.fn(async ({ where }: { where: Scope }) => devices.find((row) => matches(row, where)) ?? null),
    updateMany: jest.fn(async ({ where, data }: Query) => {
      const rows = devices.filter((row) => matches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
  },
  loginChallenge: { updateMany: jest.fn(async ({ where, data }: Query) => {
    const rows = challenges.filter((row) => matches(row, where));
    rows.forEach((row) => Object.assign(row, data));
    return { count: rows.length };
  }) },
  auditLog: { create: jest.fn(async ({ data }: { data: Scope }) => {
    if (failAudit) throw new Error("Audit unavailable");
    audits.push(data); return data;
  }) },
  $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => {
    const saved = structuredClone({ devices, challenges, audits });
    try { return await work(db); } catch (error) { ({ devices, challenges, audits } = saved); throw error; }
  }),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { NODE_ENV: "production" } }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, invalidateCache: jest.fn(async () => {}), getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load() }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ hashToken: hash }));
const { requestContext } = await import("@/lib/requestContext.js");
const { AppError } = await import("@/utils/AppError.js");
jest.unstable_mockModule("@/modules/auth/authorization.js", () => ({ loadAuthorization: async (id: string) => {
  const user = users.find((row) => row.id === id);
  if (!user) throw new AppError(401, "Authentication is required");
  return user;
} }));
jest.unstable_mockModule("@/middleware/auth.js", () => ({ authenticate: ((req, _res, next) => {
  const user = users.find((row) => `Bearer ${row.id}` === req.headers.authorization);
  if (!user) return next(new AppError(401, "Authentication is required"));
  const context = requestContext.get()!;
  Object.assign(context, { userId: user.id, organizationId: user.organizationId ?? undefined });
  next();
}) satisfies RequestHandler }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {
  recordInTransaction: async (_db: unknown, data: Scope) => db.auditLog.create({ data }),
} }));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => {
  const limit: RequestHandler = (_req, res, next) => {
    if (limited) { res.setHeader("Retry-After", "60"); return next(new AppError(429, "Too many requests")); }
    next();
  };
  return { apiLimiter: limit, strictLimiter: limit, writeLimmiter: limit };
});
const { default: routes } = await import("@/modules/auth/trusted-device.routes.js");
const { trustedDeviceService, revokeAuthenticationFactors } = await import("@/modules/auth/trusted-device.service.js");
const app = express();
app.use(express.json(), cookieParser());
app.use((_req, _res, next) => requestContext.run({ requestId: "device-test" }, next));
app.use("/api/auth/trusted-devices", routes);
const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" });
app.use(errors);
const call = (method: "get" | "delete", id = "", user = "staff-a") => request(app)[method]("/api/auth/trusted-devices" + (id ? "/" + id : "")).set("Authorization", `Bearer ${user}`);
beforeEach(() => {
  jest.clearAllMocks(); failAudit = false; limited = false; audits = [];
  devices = [factor("current"), factor("second"), factor("sibling", "other-a"), factor("foreign", "staff-b", "org-b"), factor("platform", "platform", null, "system-admin")];
  challenges = [factor("challenge"), factor("admin-challenge", "staff-a", "org-a", "system-admin"), factor("foreign-challenge", "staff-b", "org-b")];
});

test("lists only current user's current-tenant devices and identifies the HTTP-only cookie without exposing hashes", async () => {
  const result = await call("get").query({ userId: "staff-b", organizationId: "org-b" }).set("Cookie", "trustedDeviceTenant=current");
  expect(result.status).toBe(200);
  expect(result.body.data).toHaveLength(2);
  expect(result.body.data[0]).toMatchObject({ id: "current", name: "Chrome on Windows", isCurrent: true });
  expect(result.body.data[1].isCurrent).toBe(false);
  expect(JSON.stringify(result.body)).not.toContain(hash("current"));
  expect(db.trustedDevice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "staff-a", organizationId: "org-a" }) }));
});

test("does not display expired or revoked trust", async () => {
  devices[0]!.expiresAt = new Date(Date.now() - 1);
  devices[1]!.revokedAt = new Date();
  expect((await call("get")).body.data).toEqual([]);
});

test.each(["get", "delete"] as const)("requires authentication for %s", async (method) => {
  expect((await request(app)[method]("/api/auth/trusted-devices")).status).toBe(401);
  expect(db.trustedDevice.findMany).not.toHaveBeenCalled();
  expect(db.trustedDevice.updateMany).not.toHaveBeenCalled();
});

test.each(["sibling", "foreign", "missing", "platform"])("revoking an unavailable target returns the same safe 404: %s", async (id) => {
  const before = structuredClone(devices);
  expect((await call("delete", id)).status).toBe(404);
  expect(devices).toEqual(before);
  expect(audits).toEqual([]);
});

test("revokes the current device atomically and clears only its cookie", async () => {
  const result = await call("delete", "current").set("Cookie", "trustedDeviceTenant=current");
  expect(result.status).toBe(200);
  expect(result.body.data).toEqual({ devicesRevoked: 1 });
  expect(devices[0]!.revokedAt).toBeInstanceOf(Date);
  expect(devices[1]!.revokedAt).toBeNull();
  expect(result.headers["set-cookie"]?.[0]).toContain("trustedDeviceTenant=;");
  expect(result.headers["set-cookie"]?.[0]).toContain("HttpOnly; Secure; SameSite=Strict");
  expect(audits[0]).toMatchObject({ action: "auth.2fa.device.revoked", entityId: "current", after: { devicesRevoked: 1 } });
});

test("revoking another device leaves the current cookie alone", async () => {
  const result = await call("delete", "second").set("Cookie", "trustedDeviceTenant=current");
  expect(result.status).toBe(200);
  expect(result.headers["set-cookie"]).toBeUndefined();
});

test("revokes all own surfaces and clears both cookies without changing other users", async () => {
  devices.push(factor("admin-surface", "staff-a", "org-a", "system-admin"));
  devices.push(factor("historical-tenant", "staff-a", "previous-org"));
  const result = await call("delete");
  expect(result.status).toBe(200);
  expect(result.body.data).toEqual({ devicesRevoked: 4 });
  expect(devices.filter((row) => row.userId === "staff-a").every((row) => row.revokedAt instanceof Date)).toBe(true);
  expect(devices.filter((row) => row.userId !== "staff-a").every((row) => row.revokedAt === null)).toBe(true);
  expect(result.headers["set-cookie"]).toHaveLength(2);
});

test("platform identity can manage only its own platform trust and receives platform audit scope", async () => {
  const list = await call("get", "", "platform").set("Cookie", "trustedDeviceAdmin=platform");
  expect(list.body.data).toHaveLength(1);
  expect(list.body.data[0]).toMatchObject({ id: "platform", isCurrent: true, surface: "system-admin" });
  expect((await call("delete", "platform", "platform")).status).toBe(200);
  expect(audits[0]).toMatchObject({ scope: "PLATFORM", actorType: "SYSTEM_ADMIN", organizationId: null });
});

test("audit failure rolls back revocation", async () => {
  failAudit = true;
  expect((await call("delete", "current")).status).toBe(500);
  expect(devices[0]!.revokedAt).toBeNull();
});

test.each(["get", "delete"] as const)("%s preserves the limiter's 429 and Retry-After", async (method) => {
  limited = true;
  const response = await call(method);
  expect(response.status).toBe(429);
  expect(response.headers["retry-after"]).toBe("60");
  expect(db.trustedDevice.updateMany).not.toHaveBeenCalled();
});

test("service refuses mismatched trusted tenant context", async () => {
  await expect(requestContext.run({ requestId: "mismatch", userId: "staff-a", organizationId: "org-b" }, () => trustedDeviceService.list())).rejects.toMatchObject({ statusCode: 401 });
});

test("factor revocation consumes all login challenges and trust surfaces only within a verified scope", async () => {
  devices.push(factor("admin-surface", "staff-a", "org-a", "system-admin"));
  devices.push(factor("historical-tenant", "staff-a", "previous-org"));
  challenges.push(factor("historical-code", "staff-a", "previous-org"));
  const result = await revokeAuthenticationFactors(db as unknown as Prisma.TransactionClient, "staff-a");
  expect(result).toEqual({ devicesRevoked: 4, challengesConsumed: 3 });
  expect(challenges[0]!.consumedAt).toBeInstanceOf(Date);
  expect(challenges[1]!.consumedAt).toBeInstanceOf(Date);
  expect(challenges[2]!.consumedAt).toBeNull();
  expect(db.trustedDevice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "staff-a", revokedAt: null } }));
});
