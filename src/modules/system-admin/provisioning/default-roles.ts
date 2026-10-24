import type { Prisma } from "@/generated/prisma/client";
import { DEFAULT_ROLE_DEFINITIONS } from "@/constants/default-roles";
import { AppError } from "@/utils/AppError";

/** Create the established tenant role defaults inside the caller's provisioning transaction. */
export async function createDefaultTenantRoles(db: Prisma.TransactionClient, organizationId: string) {
  const names = [...new Set(DEFAULT_ROLE_DEFINITIONS.flatMap((definition) => [...definition.permissionNames]))];
  const permissions = await db.permission.findMany({
    where: { name: { in: names }, organizationId: null }, select: { id: true, name: true },
  });
  if (permissions.length !== names.length)
    throw new AppError(409, "Default tenant permissions must be provisioned before creating a workspace");
  let adminRoleId: string | undefined;
  for (const definition of DEFAULT_ROLE_DEFINITIONS) {
    const role = await db.role.create({
      data: {
        name: definition.name, organizationId,
        permissions: { create: permissions.filter((permission) => definition.permissionNames.includes(permission.name))
          .map((permission) => ({ permissionId: permission.id, isActive: true })) },
      },
      select: { id: true },
    });
    if (definition.name === "Admin") adminRoleId = role.id;
  }
  if (!adminRoleId) throw new Error("Default Admin role is missing");
  return adminRoleId;
}
