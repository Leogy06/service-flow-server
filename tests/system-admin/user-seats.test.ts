import { jest } from "@jest/globals";
type Row = Record<string, any>;
let users: Row[];
let audits: Row[];
let refreshTokens: Row[];
let failAudit = false;
let maxActiveUsers = 2;
const match = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => value === undefined ||
  (value && typeof value === "object" && "not" in value ? row[key] !== value.not : row[key] === value));
const db = {
  refreshToken: { deleteMany: jest.fn(async ({ where }: Row) => {
    const before = refreshTokens.length;
    refreshTokens = refreshTokens.filter((row) => !match(row, where));
    return { count: before - refreshTokens.length };
  }) },
  organization: { findUnique: jest.fn(async () => ({ id: "org-a", billingEnabled: true })) },
  subscription: { findUnique: jest.fn(async () => ({ plan: { maxActiveUsers } })) },
  role: { findFirst: jest.fn(async () => ({ id: "staff-role", organizationId: "org-a" })) },
  user: {
    findUnique: jest.fn(async ({ where }: Row) => structuredClone(users.find((row) => match(row, where)) ?? null)),
    findFirst: jest.fn(async ({ where }: Row) => structuredClone(users.find((row) => match(row, where)) ?? null)),
    count: jest.fn(async ({ where }: Row) => users.filter((row) => match(row, where)).length),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: "created-user", deletedAt: null, platformRole: "NONE", securityStatus: "ACTIVE", sessionVersion: 0, ...data,
        organizationId: data.organization.connect.id, roleId: data.role.connect.id };
      users.push(row); return row;
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = users.find((item) => match(item, where));
      if (!row) throw new Error("Fixture missing");
      for (const [key, value] of Object.entries(data)) {
        row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
      }
      return structuredClone(row);
    }),
  },
};
async function accessTransaction(work: (client: typeof db) => Promise<unknown>) {
  const before = structuredClone({ users, audits, refreshTokens });
  try { return await work(db); } catch (error) { ({ users, audits, refreshTokens } = before); throw error; }
}
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { SALT_ROUNDS: 4 } }));
jest.unstable_mockModule("@/modules/role/tenant-access-policy.js", () => ({ accessTransaction,
  requireTenantAdmin: jest.fn(async () => ({ organizationId: "org-a" })), requireAssignableRole: jest.fn(async () => {}) }));
jest.unstable_mockModule("@/modules/system-admin/platform-audit.js", () => ({ lockOrganization: jest.fn(async () => {}) }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {
  recordInTransaction: jest.fn(async (_db: unknown, event: Row) => { if (failAudit) throw new Error("Audit unavailable"); audits.push(event); }),
} }));
jest.unstable_mockModule("@/lib/email/send-invite", () => ({ sendInviteEmail: jest.fn(async () => {}) }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, invalidateCache: jest.fn(async () => {}),
  getOrSetCache: async (_key: string, _ttl: number, work: () => Promise<unknown>) => work() }));
const { userService } = await import("@/modules/user/user.service.js");
const input = { firstName: "New", lastName: "Staff", email: "new@example.invalid", password: "ValidPassword123!", roleId: "staff-role", organizationId: "foreign-org" };
beforeEach(() => {
  jest.clearAllMocks(); failAudit = false; maxActiveUsers = 2; audits = [];
  users = [{ id: "owner", organizationId: "org-a", roleId: "admin-role", email: "owner@example.invalid", status: "ACTIVE", securityStatus: "BLOCKED", platformRole: "NONE", sessionVersion: 0, deletedAt: null },
    { id: "archived", organizationId: "org-a", roleId: "staff-role", email: "archived@example.invalid", status: "ACTIVE", securityStatus: "BLOCKED", platformRole: "NONE", sessionVersion: 0, deletedAt: new Date(), password: "private-hash" }];
  refreshTokens = [{ id: "owner-session", userId: "owner" }, { id: "archived-session", userId: "archived" }];
});

test("direct creation explicitly activates a seat in the trusted tenant and audits atomically", async () => {
  const result = await userService.createDirect(input);
  expect(result).toMatchObject({ status: "ACTIVE", organizationId: "org-a" });
  expect(result).not.toHaveProperty("password");
  expect(audits).toHaveLength(1);
  expect(audits[0].after).not.toHaveProperty("password");
});

test("direct creation rejects a full plan including blocked owner seats", async () => {
  maxActiveUsers = 1;
  await expect(userService.createDirect(input)).rejects.toMatchObject({ statusCode: 409 });
  expect(db.user.create).not.toHaveBeenCalled();
});

test("restoring an active blocked account requires a seat and preserves its block", async () => {
  const result = await userService.restore("archived", "org-a");
  expect(result).toMatchObject({ status: "ACTIVE", securityStatus: "BLOCKED", deletedAt: null, sessionVersion: 1 });
  expect(refreshTokens).toEqual([{ id: "owner-session", userId: "owner" }]);
  expect(audits).toHaveLength(1);
});

test("restoration cannot exceed the limit or cross organization boundaries", async () => {
  maxActiveUsers = 1;
  await expect(userService.restore("archived", "org-a")).rejects.toMatchObject({ statusCode: 409 });
  await expect(userService.restore("archived", "org-b")).rejects.toMatchObject({ statusCode: 404 });
  expect(users[1]!.deletedAt).not.toBeNull();
});

test("restoring a pending invitation does not consume an active seat or activate it", async () => {
  maxActiveUsers = 1; users[1]!.status = "PENDING";
  expect(await userService.restore("archived", "org-a")).toMatchObject({ status: "PENDING", deletedAt: null });
});

test("audit failure rolls back both direct creation and restoration", async () => {
  failAudit = true;
  await expect(userService.createDirect(input)).rejects.toThrow("Audit unavailable");
  expect(users).toHaveLength(2);
  await expect(userService.restore("archived", "org-a")).rejects.toThrow("Audit unavailable");
  expect(users[1]!.deletedAt).not.toBeNull();
  expect(users[1]!.sessionVersion).toBe(0);
  expect(refreshTokens.some((row) => row.userId === "archived")).toBe(true);
});

test("deletion and restoration both invalidate prior token versions and refresh sessions", async () => {
  const created = await userService.createDirect(input);
  const oldTokenVersion = created.sessionVersion;
  refreshTokens.push({ id: "staff-before-delete", userId: created.id });
  const deleted = await userService.delete(created.id, "org-a", "owner");
  expect(deleted).toMatchObject({ sessionVersion: oldTokenVersion + 1, status: "ACTIVE", securityStatus: "ACTIVE" });
  expect(deleted.deletedAt).not.toBeNull();
  expect(refreshTokens.some((row) => row.userId === created.id)).toBe(false);
  // Restoration also removes any legacy refresh row retained while deleted.
  refreshTokens.push({ id: "legacy-deleted-session", userId: created.id });
  const restored = await userService.restore(created.id, "org-a");
  expect(restored).toMatchObject({ sessionVersion: oldTokenVersion + 2, deletedAt: null, status: "ACTIVE", securityStatus: "ACTIVE" });
  expect(restored.sessionVersion).not.toBe(oldTokenVersion);
  expect(refreshTokens.some((row) => row.userId === created.id)).toBe(false);
  expect(refreshTokens.some((row) => row.userId === "owner")).toBe(true);
  expect(audits.slice(-2).map((event) => ({ action: event.action, revoked: event.after.sessionsRevoked }))).toEqual([
    { action: "delete.user.success", revoked: 1 }, { action: "restore.user.success", revoked: 1 },
  ]);
});

test("failed deletion audit rolls back deletion, token version and refresh revocation", async () => {
  const created = await userService.createDirect(input);
  refreshTokens.push({ id: "staff-session", userId: created.id });
  failAudit = true;
  await expect(userService.delete(created.id, "org-a", "owner")).rejects.toThrow("Audit unavailable");
  expect(users.find((row) => row.id === created.id)).toMatchObject({ deletedAt: null, sessionVersion: 0 });
  expect(refreshTokens.some((row) => row.userId === created.id)).toBe(true);
  expect(audits).toHaveLength(1);
});

test("delete retains self-deletion, organization and platform identity protections", async () => {
  await expect(userService.delete("owner", "org-a", "owner")).rejects.toMatchObject({ statusCode: 400 });
  await expect(userService.delete("owner", "org-b", "different-actor")).rejects.toMatchObject({ statusCode: 404 });
  users[0]!.platformRole = "SYSTEM_ADMIN";
  await expect(userService.delete("owner", "org-a", "different-actor")).rejects.toMatchObject({ statusCode: 404 });
  expect(db.user.update).not.toHaveBeenCalled();
  expect(db.refreshToken.deleteMany).not.toHaveBeenCalled();
});
