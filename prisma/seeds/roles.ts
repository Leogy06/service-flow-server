import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { TENANT_GRANTABLE_PERMISSIONS } from "../../src/constants/tenant-grantable-permissions.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";

export const TENANT_ADMIN_PERMISSIONS: readonly string[] = [
  ...TENANT_GRANTABLE_PERMISSIONS,
  PERMISSIONS.USER_CREATE, PERMISSIONS.USER_READ, PERMISSIONS.USER_UPDATE, PERMISSIONS.USER_DELETE,
  PERMISSIONS.ROLE_CREATE, PERMISSIONS.ROLE_READ, PERMISSIONS.ROLE_UPDATE, PERMISSIONS.ROLE_DELETE,
];

export const seedRoles = async (prisma: PrismaClient, organizations: { id: string }[], permissions: { id: string; name: string }[]) => {
  console.log("Seeding roles...");

  const roles: { id: string; name: string; organizationId: string | null }[] = [];

  for (const org of organizations) {
    const adminPerms = permissions.filter((p) => TENANT_ADMIN_PERMISSIONS.includes(p.name));
    const businessPerms = permissions.filter((p) => TENANT_GRANTABLE_PERMISSIONS.includes(p.name));
    const managerPerms = businessPerms.filter((p) => !p.name.endsWith(":delete"));
    const staffPerms = businessPerms.filter(
      (p) => p.name.endsWith(":read") || p.name.endsWith(":update"),
    );

    const roleDefs = [
      { name: "Admin", perms: adminPerms },
      { name: "Manager", perms: managerPerms },
      { name: "Staff", perms: staffPerms },
    ];

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
