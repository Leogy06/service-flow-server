import type { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";

// User overrides take precedence over role defaults for login, refresh and requests.
export const authorizationSelect = {
  id: true, email: true, firstName: true, lastName: true,
  middleName: true, suffix: true, status: true, deletedAt: true,
  organizationId: true,
  organization: { select: { slug: true } },
  role: { select: {
    id: true, name: true, organizationId: true,
    permissions: { where: { isActive: true }, select: {
      permission: { select: { id: true, name: true, organizationId: true } },
    } },
  } },
  userPermissions: { select: {
    isActive: true,
    permission: { select: { id: true, name: true, organizationId: true } },
  } },
} satisfies Prisma.UserSelect;

export type AuthorizationUser = Prisma.UserGetPayload<{ select: typeof authorizationSelect }>;

export function resolvePermissions(user: AuthorizationUser) {
  const visible = (permission: { organizationId: string | null }) =>
    permission.organizationId === null || permission.organizationId === user.organizationId;
  const inherited = user.role.organizationId === user.organizationId
    ? user.role.permissions.map((grant) => grant.permission).filter(visible)
    : [];
  const overrides = user.userPermissions.filter((override) => visible(override.permission));
  const direct = overrides.filter((override) => override.isActive).map((override) => override.permission);
  const denied = new Set(overrides.filter((override) => !override.isActive).map((override) => override.permission.name));
  const names = [...new Set([...inherited, ...direct].map((p) => p.name))].filter((name) => !denied.has(name));
  return { inherited, direct, overrides, names };
}

export async function loadAuthorization(id: string, db: Prisma.TransactionClient = prisma) {
  const user = await db.user.findUnique({ where: { id }, select: authorizationSelect });
  if (!user || user.deletedAt || user.status !== "ACTIVE" ||
    user.role.organizationId !== user.organizationId) {
    throw new AppError(401, "Session is no longer valid");
  }
  return user;
}

export function sessionUser(user: AuthorizationUser) {
  return {
    id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName,
    middleName: user.middleName, suffix: user.suffix, role: user.role.name,
    organizationId: user.organizationId ?? undefined,
    slug: user.organization?.slug, permissions: resolvePermissions(user).names,
  };
}
