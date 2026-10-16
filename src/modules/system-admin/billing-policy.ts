import { Prisma } from "@/generated/prisma/client.js";
import { AppError } from "@/utils/AppError.js";

export function billingPeriod(now: Date, previousExpiration: Date | null, interval: "MONTHLY" | "YEARLY" = "YEARLY") {
  const startsAt = new Date(Math.max(now.getTime(), previousExpiration?.getTime() ?? 0));
  const expiresAt = new Date(startsAt);
  // Move from day one to avoid overflowing Jan 31 into March. Clamp to the
  // final day of the target month, preserving the UTC time of day.
  const day = startsAt.getUTCDate();
  expiresAt.setUTCDate(1);
  if (interval === "MONTHLY") expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 1);
  else expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1);
  const lastDay = new Date(Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth() + 1, 0)).getUTCDate();
  expiresAt.setUTCDate(Math.min(day, lastDay));
  return { startsAt, expiresAt };
}

export function assertExactPayment(amount: Prisma.Decimal | string, currency: string, expectedAmount: Prisma.Decimal | string, expectedCurrency: string) {
  if (currency !== expectedCurrency || !new Prisma.Decimal(amount).equals(expectedAmount)) {
    throw new AppError(409, "Payment must exactly match the selected plan renewal amount and currency");
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
