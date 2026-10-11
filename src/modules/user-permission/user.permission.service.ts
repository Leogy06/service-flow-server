import type { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "@/lib/prisma.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import { resolvePermissions, type AuthorizationUser } from "@/modules/auth/authorization.js";
import { auditService } from "@/modules/audit/audit.service.js";
import { AppError } from "@/utils/AppError.js";
import { requestContext } from "@/lib/requestContext.js";
import {
  accessTransaction, findManagedUser, requireAssignableRole, requireTenantAdmin,
  userIsProtected, validateGrants, requirePlatformAuthority,
} from "@/modules/role/tenant-access-policy.js";
import type { PermissionOverride, UserPermissionUpdate } from "./user.permission.schema.js";

function overrideSnapshot(user: AuthorizationUser) {
  return resolvePermissions(user).overrides.map(({ permission, isActive }) => ({ permissionId: permission.id, isActive }));
}

async function persistOverrides(db: Prisma.TransactionClient, userId: string, input: UserPermissionUpdate) {
  const changes: PermissionOverride[] = "overrides" in input
    ? input.overrides
    : input.permissionIds.map((permissionId) => ({ permissionId, state: "grant" }));
  if ("permissionIds" in input) {
    // Older callers manage additional grants only. Preserve explicit denials they cannot display.
    await db.userPermission.deleteMany({ where: { userId, isActive: true } });
  }
  for (const change of changes) {
    if (change.state === "inherit") {
      await db.userPermission.deleteMany({ where: { userId, permissionId: change.permissionId } });
    } else {
      const isActive = change.state === "grant";
      await db.userPermission.upsert({
        where: { userId_permissionId: { userId, permissionId: change.permissionId } },
        create: { userId, permissionId: change.permissionId, isActive }, update: { isActive },
      });
    }
  }
}

const changedIds = (input: UserPermissionUpdate) => "overrides" in input
  ? input.overrides.map((override) => override.permissionId) : input.permissionIds;

export const userPermissionService = {
  async getById(userId: string) {
    const actor = await requireTenantAdmin(prisma, PERMISSIONS.USER_READ);
    const user = await findManagedUser(prisma, userId, actor);
    const permissions = resolvePermissions(user);
    return {
      id: user.id, firstName: user.firstName, middleName: user.middleName,
      lastName: user.lastName, suffix: user.suffix, email: user.email, status: user.status,
      role: { id: user.role.id, name: user.role.name },
      inheritedPermissions: permissions.inherited.map(({ id, name }) => ({ id, name })),
      directPermissions: permissions.direct.map(({ id, name }) => ({ id, name })),
      overrides: permissions.overrides.map(({ permission, isActive }) => ({ permissionId: permission.id, name: permission.name, isActive })),
      effectivePermissions: permissions.names, protected: userIsProtected(user, actor),
    };
  },
  async updateUserPermissions(userId: string, input: UserPermissionUpdate) {
    return accessTransaction(async (db) => {
      const actor = await requireTenantAdmin(db, PERMISSIONS.USER_UPDATE);
      const user = await findManagedUser(db, userId, actor);
      if (userIsProtected(user, actor)) throw new AppError(403, "This user is protected or outside your grantable authority");
      // All three states require management authority: Inherit can restore a role grant.
      await validateGrants(db, changedIds(input), actor);
      const before = overrideSnapshot(user);
      await persistOverrides(db, user.id, input);
      const current = await findManagedUser(db, user.id, actor);
      const after = overrideSnapshot(current);
      await auditService.recordInTransaction(db, {
        action: "update.user.permissions.success", entity: "User", entityId: user.id,
        before, after,
      });
      return { id: user.id, overrides: after, permissionIds: resolvePermissions(current).direct.map((p) => p.id), effectivePermissions: resolvePermissions(current).names };
    });
  },
  async assignRole(userId: string, roleId: string) {
    return accessTransaction(async (db) => {
      const actor = await requireTenantAdmin(db, PERMISSIONS.USER_UPDATE);
      const user = await findManagedUser(db, userId, actor);
      if (userIsProtected(user, actor)) throw new AppError(403, "This user is protected or outside your grantable authority");
      const role = await requireAssignableRole(db, roleId, actor);
      await db.user.update({ where: { id: user.id, organizationId: actor.organizationId, deletedAt: null }, data: { roleId: role.id } });
      await auditService.recordInTransaction(db, {
        action: "update.user.role.success", entity: "User", entityId: user.id,
        before: { roleId: user.role.id }, after: { roleId: role.id },
      });
      return { id: user.id, roleId: role.id };
    });
  },
  async systemAdminUpdatePermission(userId: string, input: UserPermissionUpdate) {
    return accessTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const user = await db.user.findFirst({ where: { id: userId, deletedAt: null }, select: {
        id: true, organizationId: true,
        userPermissions: { select: { permissionId: true, isActive: true } },
      } });
      if (!user) throw new AppError(404, "User not found");
      if (user.id === requestContext.getValue("userId")) throw new AppError(403, "You cannot change your own permission overrides");
      const ids = changedIds(input);
      const permissions = await db.permission.findMany({ where: {
        id: { in: ids }, OR: [{ organizationId: null }, { organizationId: user.organizationId }],
      }, select: { id: true } });
      if (permissions.length !== ids.length) throw new AppError(400, "One or more permissions are unavailable");
      const before = user.userPermissions.map(({ permissionId, isActive }) => ({ permissionId, isActive }));
      await persistOverrides(db, user.id, input);
      const after = await db.userPermission.findMany({ where: { userId: user.id }, select: { permissionId: true, isActive: true } });
      await auditService.recordInTransaction(db, { action: "update.platform.user.permissions.success", entity: "User", entityId: user.id, before, after });
      return { id: user.id, overrides: after, permissionIds: after.filter((override) => override.isActive).map((override) => override.permissionId) };
    });
  },
};
