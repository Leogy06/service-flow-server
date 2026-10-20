import { jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import type { PrismaClient, Prisma } from "../../src/generated/prisma/client.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";

type Row = Record<string, unknown>;
let permissions: Row[];
let users: Row[];
let roles: Row[];
let audits: Row[];
let failAudit = false;
const db = {
  user: {
    findUnique: jest.fn(async ({ where }: { where: { email: string } }) => {
      const user = users.find((row) => row.email === where.email);
      return user ? { ...user, role: roles.find((row) => row.id === user.roleId) } : null;
    }),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const user = { id: "operator", deletedAt: null, securityStatus: "ACTIVE", ...data };
      users.push(user);
      return user;
    }),
  },
  role: {
    findFirst: jest.fn(async () => roles.find((row) => row.name === "Platform operator" && row.organizationId === null && row.deletedAt === null) ?? null),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const role = { id: "platform-role", deletedAt: null, ...data };
      roles.push(role);
      return role;
    }),
  },
  permission: {
    findMany: jest.fn(async () => permissions),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const row = { id: `p-${permissions.length}`, ...data };
      permissions.push(row);
      return row;
    }),
  },
};
const audit = jest.fn(async (_db: unknown, input: Row) => {
  if (failAudit) throw new Error("Audit unavailable");
  audits.push(input);
});
jest.unstable_mockModule("../../src/modules/system-admin/platform-audit.js", () => ({ recordPlatformAudit: audit }));
const { seedProduction } = await import("../../prisma/seeds/production.js");
const { bootstrapSystemAdminInTransaction, systemAdminBootstrapSchema } = await import("../../src/modules/system-admin/bootstrap.js");
const transaction = jest.fn(async (work: (tx: typeof db) => Promise<unknown>) => {
  const before = { users: [...users], roles: [...roles], permissions: [...permissions], audits: [...audits] };
  try { return await work(db); }
  catch (error) { ({ users, roles, permissions, audits } = before); throw error; }
});
const client = { $transaction: transaction } as unknown as PrismaClient;
const input = { SYSTEM_ADMIN_EMAIL: "operator@example.test", SYSTEM_ADMIN_PASSWORD: "OperatorOnly12345!", SYSTEM_ADMIN_REASON: "Provision the initial platform operator" };
beforeEach(() => {
  permissions = []; users = []; roles = []; audits = []; failAudit = false;
  jest.clearAllMocks();
});

test("preview writes no records and never returns credentials", async () => {
  const result = await seedProduction(client, input);
  expect(result.systemAdmin.status).toBe("would-create");
  expect(result.permissions.create).toHaveLength(Object.values(PERMISSIONS).length);
  expect(users).toEqual([]);
  expect(roles).toEqual([]);
  expect(permissions).toEqual([]);
  expect(audit).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(input.SYSTEM_ADMIN_PASSWORD);
});

test("apply needs only permission, user and role delegates; creates no plans or tenants", async () => {
  const result = await seedProduction(client, input, false);
  expect(result.systemAdmin.status).toBe("created");
  expect(permissions).toHaveLength(Object.values(PERMISSIONS).length);
  expect(users).toHaveLength(1);
  expect(users[0]).toMatchObject({ organizationId: null, platformRole: "SYSTEM_ADMIN", status: "ACTIVE" });
  expect(roles).toEqual([{ id: "platform-role", deletedAt: null, organizationId: null, name: "Platform operator" }]);
  expect(await bcrypt.compare(input.SYSTEM_ADMIN_PASSWORD, String(users[0]!.password))).toBe(true);
  expect(audits).toHaveLength(permissions.length + 1);
  expect(JSON.stringify(audits)).not.toContain(input.SYSTEM_ADMIN_PASSWORD);
  expect(JSON.stringify(audits)).not.toContain("$2");
});

test("repeated apply preserves an existing active platform identity, password and permission descriptions", async () => {
  await seedProduction(client, input, false);
  users[0]!.password = "changed-externally";
  permissions[0]!.description = "Operator edited description";
  const before = JSON.stringify({ users, roles, permissions, audits });
  const result = await seedProduction(client, input, false);
  expect(result.systemAdmin.status).toBe("preserved");
  expect(result.permissions.create).toEqual([]);
  expect(JSON.stringify({ users, roles, permissions, audits })).toBe(before);
});

test.each(["NONE", "SYSTEM_ADMIN"])("never promotes or reuses tenant-owned email (platformRole=%s)", async (platformRole) => {
  roles.push({ id: "tenant-role", organizationId: "tenant-b", deletedAt: null });
  users.push({ id: "tenant-user", email: input.SYSTEM_ADMIN_EMAIL, organizationId: "tenant-b", roleId: "tenant-role", platformRole });
  await expect(seedProduction(client, input, false)).rejects.toThrow("never promoted");
  expect(users).toHaveLength(1);
  expect(permissions).toEqual([]);
});

test("inactive platform admins are not reactivated", async () => {
  await seedProduction(client, input, false);
  users[0]!.securityStatus = "BLOCKED";
  await expect(seedProduction(client, input, false)).rejects.toThrow("inactive");
  expect(users[0]!.securityStatus).toBe("BLOCKED");
});

test("tenant-owned permission collisions roll back the new operator too", async () => {
  permissions.push({ name: Object.values(PERMISSIONS)[0], organizationId: "foreign-tenant" });
  await expect(seedProduction(client, input, false)).rejects.toThrow("tenant-owned");
  expect(users).toEqual([]);
  expect(roles).toEqual([]);
  expect(audits).toEqual([]);
});

test("audit failure rolls back permissions and operator provisioning", async () => {
  failAudit = true;
  await expect(seedProduction(client, input, false)).rejects.toThrow("Audit unavailable");
  expect(users).toEqual([]);
  expect(roles).toEqual([]);
  expect(permissions).toEqual([]);
});

test("invalid credentials fail before database access, including bcrypt byte overflow", async () => {
  for (const password of [undefined, "short", "é".repeat(37)]) {
    await expect(seedProduction(client, { ...input, SYSTEM_ADMIN_PASSWORD: password }, false)).rejects.toThrow("Set valid SYSTEM_ADMIN");
  }
  expect(transaction).not.toHaveBeenCalled();
});

test("standalone bootstrap keeps its existing duplicate-email rejection", async () => {
  await seedProduction(client, input, false);
  await expect(bootstrapSystemAdminInTransaction(db as unknown as Prisma.TransactionClient,
    systemAdminBootstrapSchema.parse(input), { passwordHash: "unused" })).rejects.toThrow("already in use");
});
