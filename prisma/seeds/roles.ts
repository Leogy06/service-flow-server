import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { DEFAULT_ROLE_DEFINITIONS } from "../../src/constants/default-roles.js";
export { DEFAULT_ROLE_DEFINITIONS, TENANT_ADMIN_PERMISSIONS } from "../../src/constants/default-roles.js";

export const seedRoles = async (prisma: PrismaClient, organizations: { id: string }[], permissions: { id: string; name: string }[]) => {
  console.log("Seeding roles...");

  const roles: { id: string; name: string; organizationId: string | null }[] = [];

  for (const org of organizations) {
    const roleDefs = DEFAULT_ROLE_DEFINITIONS.map((definition) => ({
      name: definition.name,
      perms: permissions.filter((permission) => definition.permissionNames.includes(permission.name)),
    }));

    for (const def of roleDefs) {
      const role = await prisma.role.upsert({
        where: {
          name_organizationId: {
            name: def.name,
            organizationId: org.id,
          },
        },
        update: {},
        create: {
          name: def.name,
          organizationId: org.id,
        },
      });

      if (role.deletedAt) continue;
      await prisma.rolePermission.updateMany({ where: { roleId: role.id, permission: { name: { notIn: def.perms.map((p) => p.name) } } }, data: { isActive: false } });
      for (const perm of def.perms) {
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: perm.id,
            },
          },
          update: { isActive: true },
          create: {
            roleId: role.id,
            permissionId: perm.id,
          },
        });
      }

      roles.push(role);
    }
  }

  console.log(`Seeded ${roles.length} roles`);
  return roles;
};
