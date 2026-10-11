import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { isTenantAdminName } from "../../src/modules/role/tenant-access-policy.js";
import { seedPermissions } from "./permission.js";
import { TENANT_ADMIN_PERMISSIONS } from "./roles.js";

// Repair existing tenant Admin roles using the same defaults as the general role seed.
export async function seedAdminRoles(prisma: PrismaClient) {
  return prisma.$transaction(async (db) => {
    const definitions = await seedPermissions(db);
    const permissions = definitions.filter((permission) => TENANT_ADMIN_PERMISSIONS.includes(permission.name));
    if (permissions.length !== TENANT_ADMIN_PERMISSIONS.length || permissions.some((permission) => permission.organizationId !== null)) {
      throw new Error("Tenant Admin seeding requires all default permissions to have global definitions");
    }
    const permissionIds = permissions.map((permission) => permission.id);
    const roles = (await db.role.findMany({
      where: { organizationId: { not: null }, deletedAt: null },
      select: { id: true, name: true, organizationId: true, permissions: {
        select: { permissionId: true, isActive: true }, orderBy: { permissionId: "asc" },
      } },
    })).filter((role) => isTenantAdminName(role.name));

    let updatedRoles = 0;
    for (const role of roles) {
      const before = role.permissions;
      await db.rolePermission.updateMany({
        where: { roleId: role.id, isActive: true, permissionId: { notIn: permissionIds } },
        data: { isActive: false },
      });
      for (const permissionId of permissionIds) {
        await db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId } },
          create: { roleId: role.id, permissionId, isActive: true }, update: { isActive: true },
        });
      }
      const after = await db.rolePermission.findMany({
        where: { roleId: role.id }, select: { permissionId: true, isActive: true }, orderBy: { permissionId: "asc" },
      });
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        await db.auditLog.create({ data: {
          actorId: null, organizationId: role.organizationId, action: "seed.admin.role.permissions.success",
          entity: "Role", entityId: role.id, metadata: { source: "prisma/seed.ts", before, after },
        } });
        updatedRoles++;
      }
    }
    return { adminRoles: roles.length, updatedRoles, permissionsPerRole: permissionIds.length };
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });
}
