import type { Prisma } from "@/generated/prisma/client";

/** The caller must verify account ownership first. Revoke every factor for this globally unique user, including historical tenant/surface bindings. */
export function revokeAuthenticationFactors(db: Prisma.TransactionClient, userId: string) {
  return revokeFactors(db, { userId });
}

export function revokeOrganizationAuthenticationFactors(db: Prisma.TransactionClient, organizationId: string) {
  return revokeFactors(db, { organizationId });
}

async function revokeFactors(db: Prisma.TransactionClient, scope: { userId?: string; organizationId?: string | null }) {
  const now = new Date();
  const devices = await db.trustedDevice.updateMany({ where: { ...scope, revokedAt: null }, data: { revokedAt: now } });
  const challenges = await db.loginChallenge.updateMany({ where: { ...scope, consumedAt: null }, data: { consumedAt: now } });
  return { devicesRevoked: devices.count, challengesConsumed: challenges.count };
}
