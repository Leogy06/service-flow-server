import { Prisma } from "@/generated/prisma/client.js";
import { AppError } from "@/utils/AppError.js";

export function annualPeriod(now: Date, previousExpiration: Date | null) {
  const startsAt = new Date(Math.max(now.getTime(), previousExpiration?.getTime() ?? 0));
  const expiresAt = new Date(startsAt);
  const month = startsAt.getUTCMonth();
  expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  if (expiresAt.getUTCMonth() !== month) expiresAt.setUTCDate(0);
  return { startsAt, expiresAt };
}

export function assertExactAnnualPayment(amount: Prisma.Decimal | string, currency: string, expectedAmount: Prisma.Decimal | string, expectedCurrency: string) {
  if (currency !== expectedCurrency || !new Prisma.Decimal(amount).equals(expectedAmount)) {
    throw new AppError(409, "Payment must exactly match the annual renewal amount and currency");
  }
}

export function assertManualSubscriptionTransition(from: string, to: string) {
  const allowed = (from === "ACTIVE" && to === "PAST_DUE") ||
    (["PENDING", "ACTIVE", "PAST_DUE", "EXPIRED"].includes(from) && to === "CANCELED");
  if (!allowed) throw new AppError(409, "Subscription transition is not permitted; activation requires verified payment");
}

type Entitlement = { status: string; startsAt: Date | null; expiresAt: Date | null };
export function entitlementIsCurrent(subscription: Entitlement | null, gracePeriodDays = 0, now = new Date()) {
  if (!subscription?.startsAt || !subscription.expiresAt || subscription.startsAt > now) return false;
  if (subscription.status === "ACTIVE") return subscription.expiresAt > now;
  if (subscription.status !== "PAST_DUE") return false;
  const grace = Math.max(0, Math.min(30, gracePeriodDays));
  return subscription.expiresAt.getTime() + grace * 86_400_000 > now.getTime();
}
