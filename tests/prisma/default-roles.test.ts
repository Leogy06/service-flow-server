import { jest } from "@jest/globals";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";
import { DEFAULT_ROLE_DEFINITIONS } from "../../prisma/seeds/roles.js";

type Grant = { permissionId: string; isActive: boolean };
type Role = { id: string; name: string; organizationId: string | null; deletedAt: Date | null; permissions: Grant[] };
type Permission = { id: string; name: string; organizationId: string | null };
let roles: Role[];
let permissions: Permission[];
let audits: unknown[];
let failAudit: boolean;
const ordered = (grants: Grant[]) => grants.map((grant) => ({ ...grant })).sort((a, b) => a.permissionId.localeCompare(b.permissionId));
const db = {
  permission: { upsert: jest.fn(async ({ where }: any) => {
    let permission = permissions.find((p) => p.name === where.name);
    if (!permission) { permission = { id: where.name, name: where.name, organizationId: null }; permissions.push(permission); }
    return permission;
  }) },
  role: { findMany: jest.fn(async ({ where }: any) => roles
    .filter((role) => (where.organizationId?.not !== null || role.organizationId !== null) && (where.deletedAt !== null || !role.deletedAt))
    .map((role) => ({ ...role, permissions: ordered(role.permissions) }))) },
  rolePermission: {
    updateMany: jest.fn(async ({ where }: any) => {
      const grants = roles.find((role) => role.id === where.roleId)!.permissions;
      grants.filter((grant) => grant.isActive && !where.permissionId.notIn.includes(grant.permissionId)).forEach((grant) => { grant.isActive = false; });
    }),
    upsert: jest.fn(async ({ create }: any) => {
      const grants = roles.find((role) => role.id === create.roleId)!.permissions;
      const existing = grants.find((grant) => grant.permissionId === create.permissionId);
      if (existing) existing.isActive = true;
      else grants.push({ permissionId: create.permissionId, isActive: true });
    }),
    findMany: jest.fn(async ({ where }: any) => ordered(roles.find((role) => role.id === where.roleId)!.permissions)),
  },
  auditLog: { create: jest.fn(async ({ data }: any) => {
    if (failAudit) throw new Error("Audit failed");
    audits.push(data);
  }) },
};
const client = { ...db, $transaction: async (work: (transaction: typeof db) => Promise<unknown>) => {
  const before = structuredClone({ roles, permissions, audits });
  try { return await work(db); }
  catch (error) { ({ roles, permissions, audits } = before); throw error; }
} } as unknown as PrismaClient;
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: client }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn() }));
const { seedDefaultRoles } = await import("../../prisma/seeds/defaultRoles.js");
const { seedAdminRoles } = await import("../../prisma/seeds/adminRoles.js");

beforeEach(() => {
  jest.clearAllMocks();
  permissions = [{ id: "old-service", name: "serviceRequest:read", organizationId: null }];
  audits = []; failAudit = false;
  roles = [
    ["admin-a", "Admin", "org-a"], ["admin-b", "TENANT_ADMIN", "org-b"],
    ["manager-a", "Manager", "org-a"], ["staff-b", "Staff", "org-b"],
    ["custom", "Custom", "org-a"], ["platform", "System Admin", null], ["archived", "Staff", "org-a"],
  ].map(([id, name, organizationId]) => ({ id: id!, name: name!, organizationId,
    deletedAt: id === "archived" ? new Date() : null,
    permissions: [{ permissionId: "old-service", isActive: true }, { permissionId: PERMISSIONS.ROLE_READ, isActive: false }],
  }));
});
const names = (id: string) => roles.find((role) => role.id === id)!.permissions.filter((grant) => grant.isActive).map((grant) => grant.permissionId).sort();

test("resets all tenant defaults, restores CRUD, replaces obsolete names and preserves protected roles", async () => {
  const untouched = structuredClone(roles.slice(4));
  const result = await seedDefaultRoles(client);
  expect(result).toEqual({ matchedRoles: 4, updatedRoles: 4, permissionsPerRole: { Admin: 28, Manager: 16, Staff: 9 } });
  for (const [id, name] of [["admin-a", "Admin"], ["admin-b", "Admin"], ["manager-a", "Manager"], ["staff-b", "Staff"]]) {
    expect(names(id)).toEqual([...DEFAULT_ROLE_DEFINITIONS.find((definition) => definition.name === name)!.permissionNames].sort());
  }
  expect(roles.slice(4)).toEqual(untouched);
  expect(audits).toHaveLength(4);
  expect(audits).toContainEqual(expect.objectContaining({ organizationId: "org-b", entityId: "admin-b" }));
});

test("repeated runs do not duplicate grants or audit unchanged roles", async () => {
  await seedDefaultRoles(client);
  const before = structuredClone({ roles, audits });
  expect((await seedDefaultRoles(client)).updatedRoles).toBe(0);
  expect({ roles, audits }).toEqual(before);
});

test("admin-only seeding preserves manager and staff grants", async () => {
  const untouched = structuredClone(roles.slice(2));
  expect(await seedAdminRoles(client)).toEqual({ adminRoles: 2, updatedRoles: 2, permissionsPerRole: 28 });
  expect(roles.slice(2)).toEqual(untouched);
});

test("tenant-owned default permission definitions abort without cross-tenant grants", async () => {
  permissions.push({ id: "foreign", name: PERMISSIONS.ROLE_READ, organizationId: "org-b" });
  const before = structuredClone({ roles, permissions, audits });
  await expect(seedDefaultRoles(client)).rejects.toThrow("global definitions");
  expect({ roles, permissions, audits }).toEqual(before);
  expect(db.rolePermission.upsert).not.toHaveBeenCalled();
});

test("audit failure rolls back all permission changes", async () => {
  const before = structuredClone({ roles, permissions, audits });
  failAudit = true;
  await expect(seedDefaultRoles(client)).rejects.toThrow("Audit failed");
  expect({ roles, permissions, audits }).toEqual(before);
});
