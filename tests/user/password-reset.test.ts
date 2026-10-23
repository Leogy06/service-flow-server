import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";

const adminPassword = "AdminOriginal123!";
const staffPassword = "StaffOriginal123!";
const adminHash = await bcrypt.hash(adminPassword, 4);
const staffHash = await bcrypt.hash(staffPassword, 4);
type Row = Record<string, any>;
let users: Row[], sessions: Row[], audits: Row[];
let failAudit = false, beforeTransaction: (() => void) | undefined;
const permission = (name: string) => ({ id: name, name, organizationId: null });
const match = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);
const select = (row: Row | undefined, fields?: Row) => !row ? null : fields ? Object.fromEntries(Object.keys(fields).map((key) => [key, structuredClone(row[key])])) : structuredClone(row);
function resetData() {
  users = [
    { id: "admin-a", roleName: "Tenant Admin", org: "org-a", permissions: ["user:read", "user:update", "customer:read"], password: adminHash },
    { id: "staff-a", roleName: "Staff", org: "org-a", permissions: ["customer:read"], password: staffHash },
    { id: "staff-b", roleName: "Staff", org: "org-b", permissions: [], password: staffHash },
    { id: "other-admin", roleName: "Admin", org: "org-a", permissions: ["user:update"], password: adminHash },
    { id: "platform", roleName: "Staff", org: null, permissions: [], password: adminHash },
  ].map(({ roleName, org, permissions, ...row }) => ({
    ...row, email: `${row.id}@example.invalid`, firstName: "Test", lastName: "Staff", organizationId: org,
    deletedAt: null, status: "ACTIVE", securityStatus: "ACTIVE", platformRole: row.id === "platform" ? "SYSTEM_ADMIN" : "NONE", sessionVersion: 0,
    inviteToken: "private-old-invite", inviteTokenExpiry: new Date(),
    organization: org ? { id: org, slug: org, status: "ACTIVE", billingEnabled: false } : null,
    role: { id: `role-${row.id}`, name: roleName, organizationId: org, deletedAt: null, permissions: permissions.map((name) => ({ permission: permission(name) })) }, userPermissions: [],
  }));
  sessions = [{ userId: "staff-a", organizationId: "org-a" }, { userId: "staff-b", organizationId: "org-b" }, { userId: "admin-a", organizationId: "org-a" }];
  audits = []; failAudit = false; beforeTransaction = undefined;
}
const db = {
  trustedDevice: { updateMany: jest.fn(async (_input: unknown) => ({ count: 0 })) },
  loginChallenge: { updateMany: jest.fn(async (_input: unknown) => ({ count: 0 })) },
  user: {
    findUnique: jest.fn(async ({ where, select: fields }: Row) => select(users.find((row) => match(row, where)), fields)),
    findFirst: jest.fn(async ({ where, select: fields }: Row) => select(users.find((row) => match(row, where)), fields)),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const row = users.find((item) => match(item, where));
      if (!row) return { count: 0 };
      Object.assign(row, { ...data, sessionVersion: row.sessionVersion + data.sessionVersion.increment });
      return { count: 1 };
    }),
  },
  refreshToken: { deleteMany: jest.fn(async ({ where }: Row) => { const old = sessions.length; sessions = sessions.filter((row) => !match(row, where)); return { count: old - sessions.length }; }) },
  $queryRaw: jest.fn(async (_strings: TemplateStringsArray, id: string) => [{ id }]),
  $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => {
    beforeTransaction?.(); beforeTransaction = undefined;
    const before = structuredClone({ users, sessions, audits });
    try { return await work(db); } catch (error) { ({ users, sessions, audits } = before); throw error; }
  }),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { SALT_ROUNDS: 4 } }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, invalidateCache: jest.fn(async () => {}), getOrSetCache: async (_key: string, _ttl: number, work: () => Promise<unknown>) => work() }));
jest.unstable_mockModule("@/lib/email/send-invite", () => ({ sendInviteEmail: jest.fn(async () => {}) }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {
  recordInTransaction: async (_db: unknown, event: Row) => { if (failAudit) throw new Error("Audit unavailable"); audits.push(event); },
} }));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => { const pass = (_req: unknown, _res: unknown, next: () => void) => next(); return { strictLimiter: pass, writeLimmiter: pass, deleteLimiter: pass }; });
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (token: string) => ({ sub: token, sessionVersion: 0 }) }));
const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { default: userRoutes } = await import("@/modules/user/user.routes.js");
const app = express(); app.use(express.json(), withRequestContext); app.use("/users", authenticate, userRoutes);
app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" })) as express.ErrorRequestHandler);
const body = { currentPassword: adminPassword, newPassword: "StaffChanged456!", confirmPassword: "StaffChanged456!", reason: "Staff forgot their password", confirm: true };
const reset = (id = "staff-a", input: object = body, actor: string | null = "admin-a") => {
  const pending = request(app).post(`/users/${id}/reset-password`).send(input);
  return actor ? pending.set("Authorization", `Bearer ${actor}`) : pending;
};
beforeEach(() => { jest.clearAllMocks(); resetData(); });

test("tenant admin resets only managed staff, hashes the password, revokes sessions and writes a safe audit", async () => {
  const adminBefore = structuredClone(users[0]), foreignBefore = structuredClone(users[2]);
  const response = await reset();
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ id: "staff-a", sessionsRevoked: 1 });
  expect(await bcrypt.compare(body.newPassword, users[1]!.password)).toBe(true);
  expect(await bcrypt.compare(staffPassword, users[1]!.password)).toBe(false);
  expect(users[1]).toMatchObject({ sessionVersion: 1, inviteToken: null, inviteTokenExpiry: null, status: "ACTIVE", securityStatus: "ACTIVE" });
  expect(users[0]).toEqual(adminBefore); expect(users[2]).toEqual(foreignBefore);
  expect(sessions).toHaveLength(2);
  expect(db.trustedDevice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "staff-a", revokedAt: null } }));
  expect(db.loginChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "staff-a", consumedAt: null } }));
  expect(audits).toEqual([{ action: "auth.staff.password.reset.success", entity: "User", entityId: "staff-a", after: { reason: body.reason, sessionsRevoked: 1 } }]);
  const output = JSON.stringify({ response: response.body, audits });
  for (const secret of [adminPassword, body.newPassword, users[1]!.password, staffHash]) expect(output).not.toContain(secret);
  expect((await request(app).get("/users").set("Authorization", "Bearer staff-a")).status).toBe(401);
});

test("unauthenticated, platform and non-admin actors cannot reset staff passwords", async () => {
  expect((await reset("staff-a", body, null)).status).toBe(401);
  expect((await reset("staff-a", body, "platform")).status).toBe(403);
  users[1]!.role.permissions = ["user:read", "user:update"].map((name) => ({ permission: permission(name) }));
  expect((await reset("staff-b", body, "staff-a")).status).toBe(403);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

test.each(["staff-b", "missing"])("foreign and nonexistent targets have the same not-found response: %s", async (id) => {
  expect((await reset(id)).status).toBe(404);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

test.each(["admin-a", "other-admin"])("self and another tenant admin are protected: %s", async (id) => {
  expect((await reset(id)).status).toBe(403);
});

test("staff with protected permission grants cannot have their password taken over", async () => {
  users[1]!.role.permissions.push({ permission: permission("role:update") });
  expect((await reset()).status).toBe(403);
});

test("pending, deleted and platform identities cannot be reset through staff recovery", async () => {
  users[1]!.status = "PENDING"; expect((await reset()).status).toBe(409);
  users[1]!.status = "ACTIVE"; users[1]!.deletedAt = new Date(); expect((await reset()).status).toBe(404);
  users[1]!.deletedAt = null; users[1]!.platformRole = "SYSTEM_ADMIN"; expect((await reset()).status).toBe(404);
});

test("an incorrect administrator password changes neither the staff account nor sessions", async () => {
  expect((await reset("staff-a", { ...body, currentPassword: "Wrong123!" })).status).toBe(400);
  expect(users[1]!.password).toBe(staffHash); expect(sessions).toHaveLength(3); expect(audits).toHaveLength(0);
});

test("blocked staff remain blocked after password reset", async () => {
  users[1]!.securityStatus = "BLOCKED";
  expect((await reset()).status).toBe(200);
  expect(users[1]!.securityStatus).toBe("BLOCKED");
});

test.each([
  { confirm: false }, { newPassword: "short", confirmPassword: "short" }, { confirmPassword: "Mismatch123!" },
  { reason: "" }, { organizationId: "org-b" }, { roleId: "admin" }, { status: "ACTIVE" },
  { newPassword: "A1" + "é".repeat(36), confirmPassword: "A1" + "é".repeat(36) },
  { newPassword: adminPassword, confirmPassword: adminPassword }, { reason: `Use ${body.newPassword}` },
])("rejects invalid or unsafe request bodies %j", async (changes) => {
  expect((await reset("staff-a", { ...body, ...changes })).status).toBe(400);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

test("audit failure rolls back password, invitation fields and session revocation together", async () => {
  failAudit = true;
  expect((await reset()).status).toBe(500);
  expect(users[1]).toMatchObject({ password: staffHash, sessionVersion: 0, inviteToken: "private-old-invite" });
  expect(sessions).toHaveLength(3); expect(audits).toHaveLength(0);
});

test("administrator password/session changes during reauthentication abort the reset", async () => {
  beforeTransaction = () => { users[0]!.sessionVersion += 1; };
  expect((await reset()).status).toBe(409);
  expect(users[1]!.password).toBe(staffHash);
});

test("permission changes during the request are rechecked inside the transaction", async () => {
  beforeTransaction = () => { users[0]!.role.permissions = []; };
  expect((await reset()).status).toBe(403);
  expect(users[1]!.password).toBe(staffHash);
});
