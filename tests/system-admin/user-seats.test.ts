import { jest } from "@jest/globals";
type Row = Record<string, any>;
let users: Row[];
let audits: Row[];
let refreshTokens: Row[];
let failAudit = false;
let maxActiveUsers = 2;
let billingEnabled = true;
let transactionQueue: Promise<unknown> = Promise.resolve();
const match = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => value === undefined ||
  (value && typeof value === "object" && "in" in value ? value.in.includes(row[key]) :
    value && typeof value === "object" && "not" in value ? row[key] !== value.not : row[key] === value));
const db = {
  trustedDevice: { updateMany: jest.fn(async () => ({ count: 0 })) },
  loginChallenge: { updateMany: jest.fn(async () => ({ count: 0 })) },
  refreshToken: { deleteMany: jest.fn(async ({ where }: Row) => {
    const before = refreshTokens.length;
    refreshTokens = refreshTokens.filter((row) => !match(row, where));
    return { count: before - refreshTokens.length };
  }) },
  organization: { findUnique: jest.fn(async () => ({ id: "org-a", billingEnabled })) },
  subscription: { findUnique: jest.fn(async () => ({ plan: { maxActiveUsers } })) },
  role: { findFirst: jest.fn(async () => ({ id: "staff-role", organizationId: "org-a" })) },
  user: {
    findUnique: jest.fn(async ({ where }: Row) => structuredClone(users.find((row) => match(row, where)) ?? null)),
    findFirst: jest.fn(async ({ where }: Row) => structuredClone(users.find((row) => match(row, where)) ?? null)),
    count: jest.fn(async ({ where }: Row) => users.filter((row) => match(row, where)).length),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: `created-user-${users.length}`, deletedAt: null, platformRole: "NONE", securityStatus: "ACTIVE", sessionVersion: 0, ...data,
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
function accessTransaction(work: (client: typeof db) => Promise<unknown>) {
  // Model serialized tenant mutations; real database locking requires the MySQL suite.
  const result = transactionQueue.then(async () => {
    const before = structuredClone({ users, audits, refreshTokens });
    try { return await work(db); } catch (error) { ({ users, audits, refreshTokens } = before); throw error; }
  });
  transactionQueue = result.catch(() => {});
  return result;
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
const { sendInviteEmail } = await import("@/lib/email/send-invite");
const input = { firstName: "New", lastName: "Staff", email: "new@example.invalid", password: "ValidPassword123!", roleId: "staff-role", organizationId: "foreign-org" };
beforeEach(() => {
  jest.clearAllMocks(); failAudit = false; maxActiveUsers = 2; billingEnabled = true; audits = []; transactionQueue = Promise.resolve();
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

test("a three-user plan includes the admin and pending invitations when adding users", async () => {
  maxActiveUsers = 3;
  await userService.createWithInvite(input);
  await userService.createWithInvite({ ...input, email: "second@example.invalid" });
  await expect(userService.createWithInvite({ ...input, email: "fourth@example.invalid" }))
    .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("including pending invitations") });
  expect(users.filter((row) => row.organizationId === "org-a" && !row.deletedAt)).toHaveLength(3);
  expect(db.user.create).toHaveBeenCalledTimes(2);
  expect(sendInviteEmail).toHaveBeenCalledTimes(2);
  expect(audits).toHaveLength(2);
});

test("invitations cannot be created when active accounts already fill the plan", async () => {
  maxActiveUsers = 1;
  await expect(userService.createWithInvite(input)).rejects.toMatchObject({ statusCode: 409 });
  expect(db.user.create).not.toHaveBeenCalled();
  expect(sendInviteEmail).not.toHaveBeenCalled();
  expect(audits).toHaveLength(0);
});

test("an invitation reserves the final place in the trusted tenant without exposing secrets", async () => {
  users.push({ ...users[0], id: "foreign", email: "foreign@example.invalid", organizationId: "org-b" },
    { ...users[0], id: "platform", email: "platform@example.invalid", platformRole: "SYSTEM_ADMIN" });
  const result = await userService.createWithInvite(input);
  expect(result).toMatchObject({ status: "PENDING", organizationId: "org-a" });
  expect(result).not.toHaveProperty("inviteToken");
  expect(result).not.toHaveProperty("password");
  expect(audits[0].after).not.toHaveProperty("inviteToken");
  expect(db.user.count).toHaveBeenCalledWith({ where: {
    organizationId: "org-a", status: { in: ["ACTIVE", "PENDING"] }, deletedAt: null, platformRole: "NONE",
  } });
});

test("direct creation and restoration cannot take a place reserved by an invitation", async () => {
  await userService.createWithInvite(input);
  await expect(userService.createDirect({ ...input, email: "direct@example.invalid" })).rejects.toMatchObject({ statusCode: 409 });
  await expect(userService.restore("archived", "org-a")).rejects.toMatchObject({ statusCode: 409 });
  expect(users[1]!.deletedAt).not.toBeNull();
});

test("simultaneous invitations competing for the final place admit only one user", async () => {
  const results = await Promise.allSettled([
    userService.createWithInvite(input),
    userService.createWithInvite({ ...input, email: "competing@example.invalid" }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
  expect(sendInviteEmail).toHaveBeenCalledTimes(1);
});

test("deleting a pending invitation frees capacity for a replacement", async () => {
  const invited = await userService.createWithInvite(input);
  await userService.delete(invited.id, "org-a", "owner");
  const replacement = await userService.createWithInvite({ ...input, email: "replacement@example.invalid" });
  expect(replacement).toMatchObject({ status: "PENDING", organizationId: "org-a" });
  expect(users.filter((row) => row.organizationId === "org-a" && !row.deletedAt)).toHaveLength(2);
});

test("expired invitation links still reserve capacity until their user is deleted", async () => {
  await userService.createWithInvite(input);
  users.find((row) => row.email === input.email)!.inviteTokenExpiry = new Date(Date.now() - 1000);
  await expect(userService.createWithInvite({ ...input, email: "another@example.invalid" })).rejects.toMatchObject({ statusCode: 409 });
});

test("a plan upgrade immediately permits additional invitations", async () => {
  maxActiveUsers = 1;
  await expect(userService.createWithInvite(input)).rejects.toMatchObject({ statusCode: 409 });
  maxActiveUsers = 2;
  expect(await userService.createWithInvite(input)).toMatchObject({ status: "PENDING" });
});

test("legacy tenants without billing enabled retain their existing invitation behavior", async () => {
  billingEnabled = false; maxActiveUsers = 1;
  expect(await userService.createWithInvite(input)).toMatchObject({ status: "PENDING" });
  expect(db.subscription.findUnique).not.toHaveBeenCalled();
});

test("audit failure rolls back an invitation and sends no email", async () => {
  failAudit = true;
  await expect(userService.createWithInvite(input)).rejects.toThrow("Audit unavailable");
  expect(users).toHaveLength(2);
  expect(sendInviteEmail).not.toHaveBeenCalled();
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

test("restoring a pending invitation reserves capacity without activating it", async () => {
  users[1]!.status = "PENDING";
  expect(await userService.restore("archived", "org-a")).toMatchObject({ status: "PENDING", deletedAt: null });
  await expect(userService.createWithInvite(input)).rejects.toMatchObject({ statusCode: 409 });
});

test("restoring a pending invitation cannot bypass a full plan", async () => {
  maxActiveUsers = 1; users[1]!.status = "PENDING";
  await expect(userService.restore("archived", "org-a")).rejects.toMatchObject({ statusCode: 409 });
  expect(users[1]!.deletedAt).not.toBeNull();
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
