import { jest } from "@jest/globals";
import express from "express";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";
import { Prisma } from "../../src/generated/prisma/client.js";

const oldPassword = "Original123!";
const oldHash = await bcrypt.hash(oldPassword, 4);
type UserRow = {
  id: string; email: string; firstName: string; lastName: string; middleName: string | null; suffix: string | null;
  phone: string | null; status: string; organizationId: string | null; deletedAt: Date | null; createdAt: Date;
  password: string | null; inviteToken: string; role: { id: string; name: string; organizationId: string | null; deletedAt: Date | null; permissions: { permission: { id: string; name: string; organizationId: string | null } }[] };
  userPermissions: { isActive: boolean; permission: { id: string; name: string; organizationId: string | null } }[];
};
let users: UserRow[];
let tokens: { userId: string; organizationId: string | null; expiresAt: Date }[];
let audits: unknown[];
let failAudit: boolean;
const permission = (name: string, organizationId: string | null = null) => ({ id: name, name, organizationId });
function resetData() {
  users = ["a", "b"].map((tenant) => ({
    id: `staff-${tenant}`, email: `${tenant}@example.invalid`, firstName: "Alex", lastName: "Santos", middleName: null, suffix: null,
    phone: null, status: "ACTIVE", organizationId: `org-${tenant}`, deletedAt: null, createdAt: new Date("2026-01-01"),
    password: oldHash, inviteToken: "private-invite",
    role: { id: `role-${tenant}`, name: "Staff", organizationId: `org-${tenant}`, deletedAt: null,
      permissions: [{ permission: permission("customer:read") }, { permission: permission("job:read") }] },
    userPermissions: [{ isActive: false, permission: permission("customer:read") }, { isActive: true, permission: permission("invoice:read") }, { isActive: true, permission: permission("role:update", "foreign-org") }],
  }));
  tokens = [
    { userId: "staff-a", organizationId: "org-a", expiresAt: new Date(Date.now() + 60000) },
    { userId: "staff-a", organizationId: "org-a", expiresAt: new Date(Date.now() - 60000) },
    { userId: "staff-b", organizationId: "org-b", expiresAt: new Date(Date.now() + 60000) },
  ];
  audits = []; failAudit = false;
}
function matches(user: UserRow, where: any) {
  return user.id === where.id && user.organizationId === where.organizationId && !user.deletedAt && user.status === "ACTIVE" && (where.password === undefined || user.password === where.password);
}
function selected(user: UserRow, select: any) {
  const row = { ...user, organization: user.organizationId ? { id: user.organizationId, name: user.organizationId, slug: user.organizationId, status: "ACTIVE" } : null };
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key as keyof typeof row]]));
}
const db = {
  user: {
    findUnique: jest.fn(async ({ where }: any) => users.find((user) => user.id === where.id) ?? null),
    findFirst: jest.fn(async ({ where, select }: any) => { const user = users.find((user) => matches(user, where)); return user ? selected(user, select) : null; }),
    update: jest.fn(async ({ where, data }: any) => {
      const user = users.find((user) => matches(user, where))!;
      if (data.phone && users.some((other) => other.id !== user.id && other.phone === data.phone)) throw new Prisma.PrismaClientKnownRequestError("Duplicate phone", { code: "P2002", clientVersion: "test" });
      Object.assign(user, data); return { id: user.id };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => { const user = users.find((user) => matches(user, where)); if (!user) return { count: 0 }; Object.assign(user, data); return { count: 1 }; }),
  },
  refreshToken: {
    count: jest.fn(async ({ where }: any) => tokens.filter((token) => token.userId === where.userId && token.organizationId === where.organizationId && token.expiresAt > where.expiresAt.gt).length),
    deleteMany: jest.fn(async ({ where }: any) => { const before = tokens.length; tokens = tokens.filter((token) => token.userId !== where.userId || token.organizationId !== where.organizationId); return { count: before - tokens.length }; }),
  },
  $transaction: jest.fn(async (work: any) => {
    const before = structuredClone({ users, tokens, audits });
    try { return await work(db); }
    catch (error) { ({ users, tokens, audits } = before); throw error; }
  }),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { SALT_ROUNDS: 4, ACCESS_TOKEN_EXPIRY: 900 } }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ invalidateCache: jest.fn(async () => {}) }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {
  recordInTransaction: async (_db: unknown, event: unknown) => { if (failAudit) throw new Error("Audit unavailable"); audits.push(event); },
} }));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { authLimiter: pass, strictLimiter: pass, writeLimmiter: pass };
});
jest.unstable_mockModule("@/utils/tokens.js", () => ({
  verifyAccessToken: (token: string) => ({ sub: token, organizationId: "org-b", permissions: ["user:update"] }),
  REFRESH_TOKEN_DAYS: 7, generateAccessToken: jest.fn(), generateRefreshTokenValue: jest.fn(), hashToken: jest.fn(), getRefreshExpiry: jest.fn(),
}));
const { default: authRoutes } = await import("@/modules/auth/auth.routes.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { profileService } = await import("@/modules/auth/profile.service.js");
let server: Server;
let origin: string;
beforeAll(async () => {
  const app = express(); app.use(express.json(), withRequestContext); app.use("/auth", authRoutes);
  app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" })) as express.ErrorRequestHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No listener");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { jest.clearAllMocks(); resetData(); });
async function request(path: string, method = "GET", body?: unknown, token: string | null = "staff-a") {
  const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any, cookie: response.headers.get("set-cookie") };
}
const details = { firstName: "Updated", lastName: "Santos", middleName: "", suffix: null, phone: "09171234567" };
const passwordBody = { currentPassword: oldPassword, newPassword: "Changed456!" };

test("staff can read only their own safe profile with effective overrides and unexpired sign-ins", async () => {
  const result = await request("/auth/profile?userId=staff-b&organizationId=org-b");
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ id: "staff-a", role: { name: "Staff" }, organization: { id: "org-a" }, activeSessions: 1, sessionExpiryMinutes: 15, permissions: ["invoice:read", "job:read"] });
  for (const key of ["password", "inviteToken", "userPermissions"]) expect(result.body.data).not.toHaveProperty(key);
});

test.each(["/auth/profile", "/auth/change-password", "/auth/logout-all"])("requires authentication: %s", async (path) => {
  expect((await request(path, path === "/auth/profile" ? "GET" : "POST", undefined, null)).status).toBe(401);
});

test("updates only self, with normalized optional fields and an audit record", async () => {
  const foreign = structuredClone(users[1]);
  expect((await request("/auth/profile", "PATCH", details)).status).toBe(200);
  expect(users[0]).toMatchObject({ firstName: "Updated", middleName: null, phone: details.phone, organizationId: "org-a" });
  expect(users[1]).toEqual(foreign);
  expect(audits).toContainEqual(expect.objectContaining({ action: "update.profile.success", entityId: "staff-a" }));
});

test.each(["id", "organizationId", "email", "roleId", "status", "permissions", "password"])("rejects self-service privilege changes: %s", async (key) => {
  expect((await request("/auth/profile", "PATCH", { ...details, [key]: "foreign" })).status).toBe(400);
  expect(db.user.update).not.toHaveBeenCalled();
});

test.each([{ ...details, firstName: " " }, { ...details, phone: "invalid" }])("rejects invalid profile details", async (body) => {
  expect((await request("/auth/profile", "PATCH", body)).status).toBe(400);
});

test("phone uniqueness returns a safe conflict and preserves both accounts", async () => {
  users[1].phone = details.phone;
  const before = structuredClone(users);
  const result = await request("/auth/profile", "PATCH", details);
  expect(result.status).toBe(409); expect(users).toEqual(before);
});

test("password change hashes the password, revokes only self tokens, clears the cookie and avoids secret audits", async () => {
  const foreign = structuredClone(users[1]);
  const result = await request("/auth/change-password", "POST", passwordBody);
  expect(result.status).toBe(200);
  expect(await bcrypt.compare(passwordBody.newPassword, users[0].password!)).toBe(true);
  expect(await bcrypt.compare(oldPassword, users[0].password!)).toBe(false);
  expect(users[1]).toEqual(foreign);
  expect(tokens.map((token) => token.userId)).toEqual(["staff-b"]);
  expect(result.cookie).toContain("refreshToken=;");
  expect(result.cookie).toContain("Path=/api/auth/refresh");
  expect(audits).toEqual([{ action: "auth.password.change.success", entity: "User", entityId: "staff-a", after: { sessionsRevoked: 2 } }]);
});

test.each([
  { ...passwordBody, currentPassword: "wrong" }, { ...passwordBody, newPassword: oldPassword },
  { ...passwordBody, newPassword: "short" }, { ...passwordBody, newPassword: "lowercase123" },
  { ...passwordBody, newPassword: "Ä".repeat(36) + "a1" }, { ...passwordBody, userId: "staff-b" },
])("rejects invalid password changes without changing passwords or tokens", async (body) => {
  const before = structuredClone({ users, tokens });
  expect((await request("/auth/change-password", "POST", body)).status).toBe(400);
  expect({ users, tokens }).toEqual(before);
});

test("a concurrent password change returns a conflict and preserves sign-ins", async () => {
  db.user.updateMany.mockResolvedValueOnce({ count: 0 });
  expect((await request("/auth/change-password", "POST", passwordBody)).status).toBe(409);
  expect(tokens).toHaveLength(3);
});

test("sign-out-all revokes only self refresh tokens and records an audit", async () => {
  const result = await request("/auth/logout-all", "POST");
  expect(result.status).toBe(200);
  expect(tokens.map((token) => token.userId)).toEqual(["staff-b"]);
  expect(audits).toContainEqual(expect.objectContaining({ action: "auth.logout.all.success", entityId: "staff-a" }));
});

test.each(["profile", "password"])("audit failure rolls back the %s mutation", async (kind) => {
  const before = structuredClone({ users, tokens }); failAudit = true;
  const result = kind === "profile" ? await request("/auth/profile", "PATCH", details) : await request("/auth/change-password", "POST", passwordBody);
  expect(result.status).toBe(500); expect({ users, tokens }).toEqual(before);
});

test("inactive or deleted users cannot access profile", async () => {
  users[0].status = "PENDING";
  expect((await request("/auth/profile")).status).toBe(401);
  users[0].status = "ACTIVE"; users[0].deletedAt = new Date();
  expect((await request("/auth/profile")).status).toBe(401);
});

test("service rejects missing trusted context", async () => {
  await expect(profileService.get()).rejects.toThrow("Authentication is required");
});
