import type { Prisma } from "@/generated/prisma/client.js";
import { AppError } from "@/utils/AppError.js";
import { lockOrganization } from "./platform-audit.js";
import { entitlementIsCurrent } from "./billing-policy.js";

export const activeSeatWhere = (organizationId: string) => ({ organizationId, status: "ACTIVE" as const, deletedAt: null, platformRole: "NONE" as const });
export function countActiveSeats(db: Prisma.TransactionClient, organizationId: string) {
  // Blocking an account must never release a subscription seat.
  return db.user.count({ where: activeSeatWhere(organizationId) });
}

export async function assertTenantEntitlement(db: Prisma.TransactionClient, organizationId: string) {
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { billingEnabled: true } });
  if (!organization) throw new AppError(403, "Subscription access is unavailable", "SUBSCRIPTION_REQUIRED");
  if (!organization.billingEnabled) return;
  const subscription = await db.subscription.findUnique({ where: { organizationId }, select: { status: true, startsAt: true, expiresAt: true } });
  const settings = subscription?.status === "PAST_DUE"
    ? await db.platformSettings.findUnique({ where: { id: "singleton" }, select: { gracePeriodDays: true } }) : null;
  if (!entitlementIsCurrent(subscription, settings?.gracePeriodDays ?? 0)) {
    throw new AppError(403, "An active subscription is required", "SUBSCRIPTION_REQUIRED");
  }
}

export async function enforceSeatLimit(db: Prisma.TransactionClient, organizationId: string, additionalSeats = 1) {
  if (!Number.isInteger(additionalSeats) || additionalSeats < 0) throw new AppError(400, "Seat count is invalid");
  await lockOrganization(db, organizationId);
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { billingEnabled: true } });
  if (!organization) throw new AppError(404, "Organization not found");
  if (!organization.billingEnabled) return;
  const subscription = await db.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  if (!subscription) throw new AppError(409, "Assign a subscription plan before activating accounts");
  if (await countActiveSeats(db, organizationId) + additionalSeats > subscription.plan.maxActiveUsers) {
    throw new AppError(409, "The subscription active-user limit would be exceeded");
  }
}
