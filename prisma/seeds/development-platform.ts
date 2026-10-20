import type { Plan, Prisma } from "../../src/generated/prisma/client.js";
import { billingPeriod, trialPeriod } from "../../src/modules/system-admin/billing-policy.js";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../../src/constants/legal.js";
import { DEVELOPMENT_SEED, developmentId } from "./development-data.js";

/** Fixtures apply only to organizations without a subscription; existing billing is preserved. */
export async function seedDevelopmentSubscription(db: Prisma.TransactionClient,
  organizationId: string, mode: "pending" | "paid" | "trial", plan: Plan, operatorId: string, now: Date) {
  if (await db.subscription.findUnique({ where: { organizationId } })) return;
  const id = (key: string) => developmentId(`${organizationId}:${key}`);
  const trial = mode === "trial" ? trialPeriod(now) : null;
  const period = billingPeriod(now, null, plan.billingInterval);
  const paymentId = id("subscription-payment");
  const subscription = await db.subscription.create({ data: {
    id: id("subscription"), organizationId, planId: plan.id,
    price: plan.price, currency: plan.currency, billingInterval: plan.billingInterval,
    status: mode === "paid" ? "ACTIVE" : mode === "trial" ? "TRIALING" : "PENDING",
    ...(mode === "paid" ? { ...period, currentPeriodPaymentId: paymentId, version: 1 } : {}),
    ...(trial ? { ...trial, startsAt: trial.trialStartedAt, expiresAt: trial.trialExpiresAt } : {}),
  } });
  if (mode !== "trial") {
    await db.subscriptionPayment.create({ data: {
      id: paymentId, organizationId, subscriptionId: subscription.id, amount: plan.price,
      currency: plan.currency, billingInterval: plan.billingInterval, paymentMethod: "BANK_TRANSFER",
      referenceNumber: `DEV-${organizationId}`, idempotencyKey: id("receipt-key"), paidAt: now,
      status: mode === "paid" ? "PAID" : "UNDER_REVIEW", evidence: "Fictional development receipt; no funds transferred.",
      ...(mode === "paid" ? { verifiedAt: now, verifiedBy: operatorId, verificationReason: "Simulated verified development receipt.",
        periodStartsAt: period.startsAt, periodExpiresAt: period.expiresAt } : {}),
    } });
    if (mode === "paid") {
      await db.subscriptionRefundRequest.create({ data: {
        id: id("refund-request"), paymentId, activePaymentId: paymentId, actorId: operatorId,
        idempotencyKey: id("refund-key"), reason: "Sample refund request awaiting review.",
        evidence: "Fictional development request; no refund has been issued.",
      } });
    }
  }
  await db.subscriptionHistory.create({ data: {
    subscriptionId: subscription.id, kind: mode === "trial" ? "TRIAL_STARTED" : mode === "paid" ? "PAYMENT_VERIFIED" : "ASSIGNED",
    actorId: operatorId, reason: "Simulated development subscription.",
    ...(mode === "paid" ? { paymentId } : {}),
    after: { source: DEVELOPMENT_SEED, simulated: true, status: subscription.status, planId: plan.id },
  } });
  if (mode === "pending") {
    await db.platformAlert.create({ data: {
      deduplicationKey: id("payment-alert"), organizationId, kind: "PAYMENT_UNDER_REVIEW", severity: "warning",
      message: "Sample subscription receipt is waiting for review.", targetType: "SubscriptionPayment", targetId: paymentId,
    } });
  }
  await db.auditLog.create({ data: { scope: "PLATFORM", actorId: operatorId, actorType: "SYSTEM_ADMIN",
    organizationId, action: "seed.development.subscription", entity: "Subscription", entityId: subscription.id,
    metadata: { source: DEVELOPMENT_SEED, simulated: true, status: subscription.status } } });
}

export async function seedDevelopmentSignup(db: Prisma.TransactionClient, passwordHash: string, now: Date) {
  // Acceptance evidence is explicitly synthetic; it represents no real person's agreement.
  await db.signupRequest.create({ data: {
    id: developmentId("signup"), email: "applicant@sample-cleaning.example.test", passwordHash,
    firstName: "Sample", lastName: "Applicant", organizationName: "Sample Cleaning (Development)",
    slug: "sample-cleaning-development", termsAcceptedAt: now,
    termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION,
  } });
}
