import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import { assertTenantEntitlement } from "@/modules/system-admin/entitlement";
import { PERMISSIONS } from "@/constants/permission.constants";

// User overrides take precedence over role defaults for login, refresh and requests.
export const authorizationSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  middleName: true,
  suffix: true,
  status: true,
  deletedAt: true,
  organizationId: true,
  platformRole: true,
  securityStatus: true,
  sessionVersion: true,
  organization: {
    select: { id: true, slug: true, status: true, billingEnabled: true },
  },
  role: {
    select: {
      id: true,
      name: true,
      organizationId: true,
      deletedAt: true,
      permissions: {
        where: { isActive: true },
        select: {
          permission: {
            select: { id: true, name: true, organizationId: true },
          },
        },
      },
    },
  },
  userPermissions: {
    select: {
      isActive: true,
      permission: { select: { id: true, name: true, organizationId: true } },
    },
  },
} satisfies Prisma.UserSelect;

export type AuthorizationUser = Prisma.UserGetPayload<{
  select: typeof authorizationSelect;
}>;
export const isPlatformPermissionName = (name: string) =>
  name === PERMISSIONS.SYSTEM_ADMIN_READ ||
  name === PERMISSIONS.SYSTEM_ADMIN_UPDATE;

export function resolvePermissions(
  user: Pick<
    AuthorizationUser,
    "platformRole" | "role" | "userPermissions" | "organizationId"
  >,
) {
  // Platform authority never comes from editable tenant roles or permission grants.
  if (user.platformRole === "SYSTEM_ADMIN")
    return { inherited: [], direct: [], overrides: [], names: [] as string[] };
  const visible = (permission: {
    organizationId: string | null;
    name: string;
  }) =>
    !isPlatformPermissionName(permission.name) &&
    (permission.organizationId === null ||
      permission.organizationId === user.organizationId);
  const inherited =
    !user.role.deletedAt && user.role.organizationId === user.organizationId
      ? user.role.permissions.map((grant) => grant.permission).filter(visible)
      : [];
  const overrides = user.userPermissions.filter((override) =>
    visible(override.permission),
  );
  const direct = overrides
    .filter((override) => override.isActive)
    .map((override) => override.permission);
  const denied = new Set(
    overrides
      .filter((override) => !override.isActive)
      .map((override) => override.permission.name),
  );
  const names = [
    ...new Set([...inherited, ...direct].map((p) => p.name)),
  ].filter((name) => !denied.has(name));
  return { inherited, direct, overrides, names };
}

export async function loadAuthorization(
  id: string,
  db: Prisma.TransactionClient = prisma,
) {
  const user = await db.user.findUnique({
    where: { id },
    select: authorizationSelect,
  });
  if (
    !user ||
    user.deletedAt ||
    user.status !== "ACTIVE" ||
    user.securityStatus !== "ACTIVE"
  ) {
    throw new AppError(401, "Session is no longer valid");
  }
  if (user.platformRole === "SYSTEM_ADMIN") {
    if (user.organizationId !== null)
      throw new AppError(401, "Session is no longer valid");
    return user;
  }
  if (
    !user.organizationId ||
    !user.organization ||
    user.organization.status !== "ACTIVE" ||
    user.role.deletedAt ||
    user.role.organizationId !== user.organizationId
  ) {
    throw new AppError(401, "Session is no longer valid");
  }
  if (user.organization.billingEnabled)
    await assertTenantEntitlement(db, user.organizationId);
  return user;
}

export function sessionUser(user: AuthorizationUser) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    middleName: user.middleName,
    suffix: user.suffix,
    role: user.role.name,
    organizationId: user.organizationId ?? undefined,
    slug: user.organization?.slug,
    permissions: resolvePermissions(user).names,
    platformRole: user.platformRole,
    securityStatus: user.securityStatus,
    sessionVersion: user.sessionVersion,
  };
}
