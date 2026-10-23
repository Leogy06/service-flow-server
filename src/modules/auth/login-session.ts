import type { Prisma } from "@/generated/prisma/client";
import { requestContext } from "@/lib/requestContext";
import { recordPlatformAudit } from "@/modules/system-admin/platform-audit";
import { generateAccessToken, generateRefreshTokenValue, getRefreshExpiry, hashToken } from "@/utils/tokens";
import { sessionUser, type AuthorizationUser } from "./authorization";

/** Only call after password and a second factor have been verified in this transaction. */
export async function createLoginSession(db: Prisma.TransactionClient, current: AuthorizationUser) {
  const user = sessionUser(current);
  const refreshToken = generateRefreshTokenValue();
  await db.refreshToken.create({ data: {
    token: hashToken(refreshToken), userId: current.id,
    organizationId: current.organizationId, expiresAt: getRefreshExpiry(),
  } });
  await requestContext.run({
    ...(requestContext.get() ?? { requestId: "authentication" }),
    userId: current.id, organizationId: current.organizationId ?? undefined,
  }, () => recordPlatformAudit(db, {
    action: "auth.login.success", entity: "User", entityId: current.id,
    actorType: current.platformRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "USER",
    organizationId: current.organizationId,
    after: { id: current.id, platformRole: current.platformRole },
  }));
  return {
    accessToken: generateAccessToken(user), refreshToken, user,
    organization: current.organization ? { id: current.organization.id, slug: current.organization.slug } : null,
    permissions: user.permissions,
  };
}
