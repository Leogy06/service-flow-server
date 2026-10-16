import type { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "@/lib/prisma.js";
import { requestContext } from "@/lib/requestContext.js";
import { authorizationSelect, loadAuthorization, resolvePermissions, type AuthorizationUser } from "@/modules/auth/authorization.js";
import { AppError } from "@/utils/AppError.js";
import { invalidateCache } from "@/utils/cache.js";
import { isPrismaError } from "@/utils/errorHelper.js";
import { tenantTransaction } from "@/utils/tenant-transaction.js";

import { TENANT_GRANTABLE_PERMISSIONS } from "@/constants/tenant-grantable-permissions.js";

const normalizedRoleName = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");
export const isTenantAdminName = (name: string) => ["admin", "tenantadmin"].includes(normalizedRoleName(name));
export const isPlatformAdminName = (name: string) => ["platformadmin", "systemadmin", "superadmin"].includes(normalizedRoleName(name));
export const isReservedRoleName = (name: string) => isTenantAdminName(name) || isPlatformAdminName(name);

export type TenantActor = { user: AuthorizationUser; organizationId: string; grantable: string[] };

export async function requirePlatformAuthority(db: Prisma.TransactionClient = prisma) {
  const id = requestContext.getValue("userId");
  if (!id || requestContext.getValue("organizationId")) throw new AppError(403, "Platform administration is required");
  const user = await loadAuthorization(id, db);
  if (user.organizationId !== null || user.platformRole !== "SYSTEM_ADMIN") {
    throw new AppError(403, "Platform administration is required");
  }
  return user;
}

export async function requireTenantAdmin(db: Prisma.TransactionClient, permission: string | string[]): Promise<TenantActor> {
  const id = requestContext.getValue("userId");
  const organizationId = requestContext.getValue("organizationId");
  if (!id || !organizationId) throw new AppError(403, "Tenant administration is required");
  const user = await loadAuthorization(id, db);
  const effective = resolvePermissions(user).names;
  const required = typeof permission === "string" ? [permission] : permission;
  if (user.organizationId !== organizationId || !isTenantAdminName(user.role.name) ||
    !required.some((p) => effective.includes(p))) {
    throw new AppError(403, "Forbidden");
  }
  return { user, organizationId, grantable: TENANT_GRANTABLE_PERMISSIONS.filter((p) => effective.includes(p)) };
}

export const managedRoleSelect = {
  id: true, name: true, organizationId: true, deletedAt: true,
  permissions: { where: { isActive: true }, select: {
    permission: { select: { id: true, name: true, organizationId: true } },
  } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleSelect;
export type ManagedRole = Prisma.RoleGetPayload<{ select: typeof managedRoleSelect }>;

export function roleIsProtected(role: ManagedRole, actor: TenantActor) {
  return role.organizationId !== actor.organizationId || isReservedRoleName(role.name) ||
    role.id === actor.user.role.id || role.permissions.some(({ permission: p }) =>
      !actor.grantable.includes(p.name) || (p.organizationId !== null && p.organizationId !== actor.organizationId));
}

export async function findTenantRole(db: Prisma.TransactionClient, id: string, actor: TenantActor, archived = false) {
  const role = await db.role.findFirst({ where: {
    id, organizationId: actor.organizationId, deletedAt: archived ? { not: null } : null,
  }, select: managedRoleSelect });
  if (!role) throw new AppError(404, "Role not found");
  return role;
}

export async function requireAssignableRole(db: Prisma.TransactionClient, id: string, actor: TenantActor) {
  const role = await findTenantRole(db, id, actor);
  if (roleIsProtected(role, actor)) throw new AppError(403, "Role is protected or outside your grantable authority");
  return role;
}

export function userIsProtected(user: AuthorizationUser, actor: TenantActor) {
  return user.id === actor.user.id || !!user.role.deletedAt || user.role.organizationId !== actor.organizationId ||
    isReservedRoleName(user.role.name) ||
    [...user.role.permissions, ...user.userPermissions].some(({ permission: p }) =>
      !actor.grantable.includes(p.name) || (p.organizationId !== null && p.organizationId !== actor.organizationId));
}

export async function findManagedUser(db: Prisma.TransactionClient, id: string, actor: TenantActor) {
  const user = await db.user.findFirst({
    where: { id, organizationId: actor.organizationId, deletedAt: null }, select: authorizationSelect,
  });
  if (!user) throw new AppError(404, "User not found");
  return user;
}

export async function validateGrants(db: Prisma.TransactionClient, ids: string[], actor: TenantActor) {
  const permissions = await db.permission.findMany({ where: {
    id: { in: ids }, OR: [{ organizationId: null }, { organizationId: actor.organizationId }],
  }, select: { id: true, name: true, description: true } });
  if (permissions.length !== new Set(ids).size) throw new AppError(400, "One or more permissions are unavailable");
  if (permissions.some((p) => !actor.grantable.includes(p.name))) {
    throw new AppError(403, "Permission is outside your grantable authority");
  }
  return permissions;
}

export async function accessTransaction<T>(work: (db: Prisma.TransactionClient) => Promise<T>) {
  try {
    const result = await tenantTransaction(work);
    await invalidateCache("cache:users:list*");
    await invalidateCache("cache:user:byId*");
    return result;
  } catch (error) {
    if (isPrismaError(error, "P2002")) throw new AppError(409, "A record with these values already exists");
    if (isPrismaError(error, "P2003") || isPrismaError(error, "P2025") || isPrismaError(error, "P2034")) throw new AppError(409, "Data changed during this operation. Refresh and try again");
    throw error;
  }
}
