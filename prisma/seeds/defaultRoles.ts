import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { isTenantAdminName } from "../../src/modules/role/tenant-access-policy.js";
import { seedPermissions } from "./permission.js";
import { DEFAULT_ROLE_DEFINITIONS } from "./roles.js";

// Reset existing tenant defaults without replacing roles, users or user overrides.
export async function seedDefaultRoles(prisma: PrismaClient, adminOnly = false) {
  return prisma.$transaction(async (db) => {
    const definitions = await seedPermissions(db);
    const defaults = DEFAULT_ROLE_DEFINITIONS.filter((definition) => !adminOnly || definition.name === "Admin");
    const permissionNames = [...new Set(defaults.flatMap((definition) => [...definition.permissionNames]))];
    const permissions = definitions.filter((permission) => permissionNames.includes(permission.name));
    if (permissions.length !== permissionNames.length || permissions.some((permission) => permission.organizationId !== null)) {
      throw new Error("Tenant role seeding requires all default permissions to have global definitions");
    }
    const roles = await db.role.findMany({
      where: { organizationId: { not: null }, deletedAt: null },
      select: { id: true, name: true, organizationId: true, permissions: {
        select: { permissionId: true, isActive: true }, orderBy: { permissionId: "asc" },
      } },
    });

    let matchedRoles = 0;
    let updatedRoles = 0;
    for (const role of roles) {
      const definition = defaults.find((candidate) => candidate.name === "Admin"
        ? isTenantAdminName(role.name)
        : candidate.name.toLowerCase() === role.name.trim().toLowerCase());
      if (!definition) continue;
      matchedRoles++;
      const permissionIds = permissions.filter((permission) => definition.permissionNames.includes(permission.name)).map((permission) => permission.id);
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
          actorId: null, organizationId: role.organizationId,
          action: definition.name === "Admin" ? "seed.admin.role.permissions.success" : "seed.default.role.permissions.success",
          entity: "Role", entityId: role.id, metadata: { source: "prisma/seed.ts", before, after },
        } });
        updatedRoles++;
      }
    }
    return { matchedRoles, updatedRoles, permissionsPerRole: Object.fromEntries(defaults.map((definition) => [definition.name, definition.permissionNames.length])) };
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });
}
