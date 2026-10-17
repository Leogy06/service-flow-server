import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const rawToken = "a".repeat(64);
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
type InviteUser = {
  id: string; email: string; organizationId: string; status: string;
  securityStatus: string; platformRole: string;
  password: string | null; inviteToken: string | null; inviteTokenExpiry: Date | null;
  deletedAt: Date | null; organization: { status: string };
  role: { organizationId: string; deletedAt: Date | null };
};
let users: InviteUser[];
let audits: unknown[];
let failAudit: boolean;
let loseRace: boolean;
let billingEnabled: boolean;
let activeSeats: number;
const invalidateCache = jest.fn(async (_key: string) => {});
function resetData() {
  users = ["a", "b"].map((tenant) => ({
    id: `user-${tenant}`, email: `${tenant}@example.com`, organizationId: `org-${tenant}`,
    status: "PENDING", securityStatus: "ACTIVE", platformRole: "NONE", password: null, inviteToken: hash(tenant.repeat(64)),
    inviteTokenExpiry: new Date(Date.now() + 60_000), deletedAt: null,
    organization: { status: "ACTIVE" }, role: { organizationId: `org-${tenant}`, deletedAt: null },
  }));
  audits = []; failAudit = false; loseRace = false; billingEnabled = false; activeSeats = 1;
}
function matches(user: InviteUser, where: any) {
  return ["id", "email", "organizationId", "status", "securityStatus", "platformRole", "password", "inviteToken", "deletedAt"]
    .every((key) => where[key] === undefined || user[key as keyof InviteUser] === where[key]) &&
    (!where.inviteTokenExpiry || (!!user.inviteTokenExpiry && user.inviteTokenExpiry > where.inviteTokenExpiry.gt)) &&
    (!where.organization || user.organization.status === where.organization.status) &&
    (!where.role || (user.role.deletedAt === where.role.deletedAt &&
      (!where.role.organizationId || user.role.organizationId === where.role.organizationId)));
}
const db = {
  organization: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, billingEnabled })) },
  subscription: { findUnique: jest.fn(async () => ({ status: "ACTIVE", startsAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() + 86_400_000), plan: { maxActiveUsers: 2 } })) },
  $queryRaw: jest.fn(async (_strings: TemplateStringsArray, id: string) => [{ id }]),
  user: {
    count: jest.fn(async () => activeSeats),
    findUnique: jest.fn(async ({ where }: any) => users.find((user) => matches(user, where)) ?? null),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const user = users.find((row) => matches(row, where));
      if (!user || loseRace) return { count: 0 };
      Object.assign(user, data); return { count: 1 };
    }),
  },
  $transaction: jest.fn(async (work: any) => {
    const before = structuredClone({ users, audits });
    try { return await work(db); }
    catch (error) { ({ users, audits } = before); throw error; }
  }),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { SALT_ROUNDS: 4 } }));
jest.unstable_mockModule("@/lib/email/send-invite", () => ({ sendInviteEmail: jest.fn(async () => {}) }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, invalidateCache,
  getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
}));
jest.unstable_mockModule("@/utils/tokens.js", () => ({
  REFRESH_TOKEN_DAYS: 7, generateAccessToken: jest.fn(), generateRefreshTokenValue: jest.fn(),
  hashToken: hash, getRefreshExpiry: jest.fn(), verifyAccessToken: jest.fn(),
}));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { authLimiter: pass, signupLimiter: pass, strictLimiter: pass, writeLimmiter: pass };
});
const { requestContext } = await import("@/lib/requestContext.js");
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {
  recordInTransaction: async (_db: unknown, event: unknown) => {
    if (failAudit) throw new Error("Audit unavailable");
    audits.push({ event, actorId: requestContext.getValue("userId"), organizationId: requestContext.getValue("organizationId") });
  },
} }));
const { default: authRoutes } = await import("@/modules/auth/auth.routes.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/api/auth", authRoutes);
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" });
};
app.use(errors);
const body = { email: "a@example.com", token: rawToken, password: "Welcome123!", confirmPassword: "Welcome123!" };
const submit = (input: object = body) => request(app).post("/api/auth/set-password").send(input);
beforeEach(() => { jest.clearAllMocks(); resetData(); });

test("public invite acceptance hashes the emailed token, activates only its tenant user, and returns no private data", async () => {
  const otherTenant = structuredClone(users[1]);
  const result = await submit();
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ message: "Password set successfully", data: null });
  expect(users[0]).toMatchObject({ status: "ACTIVE", inviteToken: null, inviteTokenExpiry: null });
  expect(await bcrypt.compare(body.password, users[0]!.password!)).toBe(true);
  expect(users[1]).toEqual(otherTenant);
  expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ inviteToken: hash(rawToken) }) }));
  expect(audits).toEqual([{ event: { action: "set.password.success", entity: "User", entityId: "user-a", after: { status: "ACTIVE" } }, actorId: "user-a", organizationId: "org-a" }]);
  expect(invalidateCache.mock.calls.map(([key]) => key)).toEqual(["cache:modules:v1:users:org-a:*", "cache:modules:v1:roles:org-a:*", "cache:modules:v1:jobs:org-a:*", "cache:modules:v1:upgradePlans:org-a:*", "cache:modules:v1:dashboard:org-a:*", "cache:modules:v1:platformDashboard:platform:*"]);
});

test.each([
  { ...body, email: "b@example.com" }, { ...body, email: "missing@example.com" },
  { ...body, token: "c".repeat(64) }, { ...body, token: hash(rawToken) },
])("rejects wrong email/token pairs with the same safe error", async (input) => {
  const before = structuredClone(users);
  const result = await submit(input);
  expect(result.status).toBe(400);
  expect(result.body.error).toBe("Invite link is invalid or expired. Please request a new invitation.");
  expect(users).toEqual(before);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

test.each([
  { token: undefined }, { token: "bad" }, { email: "invalid" }, { password: "short", confirmPassword: "short" },
  { password: "lowercase123", confirmPassword: "lowercase123" }, { confirmPassword: "Different123!" },
  { password: "Ä".repeat(36) + "a1", confirmPassword: "Ä".repeat(36) + "a1" },
  { organizationId: "org-b" }, { roleId: "admin-b" }, { status: "ACTIVE" },
])("validates passwords and rejects client-supplied privilege changes", async (changes) => {
  expect((await submit({ ...body, ...changes })).status).toBe(400);
  expect(db.user.findUnique).not.toHaveBeenCalled();
});

test.each(["expired", "no-expiry", "deleted", "active", "password-set", "inactive-organization", "deleted-role", "foreign-role"])("rejects unavailable invitations: %s", async (condition) => {
  const user = users[0]!;
  if (condition === "expired") user.inviteTokenExpiry = new Date(Date.now() - 1);
  if (condition === "no-expiry") user.inviteTokenExpiry = null;
  if (condition === "deleted") user.deletedAt = new Date();
  if (condition === "active") user.status = "ACTIVE";
  if (condition === "password-set") user.password = "existing-hash";
  if (condition === "inactive-organization") user.organization.status = "SUSPENDED";
  if (condition === "deleted-role") user.role.deletedAt = new Date();
  if (condition === "foreign-role") user.role.organizationId = "org-b";
  expect((await submit()).status).toBe(400);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

test("a consumed invite cannot change the password again", async () => {
  expect((await submit()).status).toBe(200);
  const savedHash = users[0]!.password;
  expect((await submit({ ...body, password: "Changed456!", confirmPassword: "Changed456!" })).status).toBe(400);
  expect(users[0]!.password).toBe(savedHash);
  expect(audits).toHaveLength(1);
});

test("a competing acceptance that consumed the invitation cannot overwrite the password", async () => {
  loseRace = true;
  expect((await submit()).status).toBe(400);
  expect(users[0]!.password).toBeNull();
  expect(audits).toHaveLength(0);
  expect(invalidateCache).not.toHaveBeenCalled();
});

test("audit failure rolls back password activation and invitation consumption", async () => {
  failAudit = true;
  const before = structuredClone(users);
  expect((await submit()).status).toBe(500);
  expect(users).toEqual(before);
  expect(invalidateCache).not.toHaveBeenCalled();
});

test("accepting an invitation cannot exceed the active-user limit", async () => {
  billingEnabled = true; activeSeats = 2;
  expect((await submit()).status).toBe(409);
  expect(users[0]!.status).toBe("PENDING");
  expect(users[0]!.password).toBeNull();
  expect(audits).toHaveLength(0);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

test("a valid invitation can consume the final available subscription seat", async () => {
  billingEnabled = true; activeSeats = 1;
  expect((await submit()).status).toBe(200);
  expect(users[0]!.status).toBe("ACTIVE");
  expect(db.user.count).toHaveBeenCalledWith({ where: { organizationId: "org-a", status: "ACTIVE", deletedAt: null, platformRole: "NONE" } });
});

test("blocked invitations cannot activate or overwrite platform security state", async () => {
  users[0]!.securityStatus = "BLOCKED";
  expect((await submit()).status).toBe(400);
  expect(users[0]!.status).toBe("PENDING");
  expect(db.user.updateMany).not.toHaveBeenCalled();
});
