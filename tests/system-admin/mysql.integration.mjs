// Opt-in real MySQL billing/seat concurrency test. Apply migrations to a separate
// disposable test database first. Immutable PLATFORM audit fixtures are retained.
import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const databaseName = process.env.DATABASE_NAME ?? "";
if (process.env.RUN_DB_PLATFORM_TESTS !== "1" || process.env.NODE_ENV !== "test" ||
    !/(?:^|_)test(?:_|$)/i.test(databaseName) || process.env.PLATFORM_TEST_DATABASE_NAME !== databaseName) {
  throw new Error("Set RUN_DB_PLATFORM_TESTS=1, NODE_ENV=test and PLATFORM_TEST_DATABASE_NAME to the exact isolated DATABASE_NAME containing a test segment.");
}
let urlDatabase;
try { urlDatabase = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "").pathname.slice(1)); }
catch { throw new Error("A valid isolated test DATABASE_URL is required."); }
if (urlDatabase !== databaseName) throw new Error("DATABASE_URL and DATABASE_NAME must identify the same isolated test database.");

const { prisma } = await import("../../src/lib/prisma.ts");
const { requestContext } = await import("../../src/lib/requestContext.ts");
const { billingService } = await import("../../src/modules/system-admin/billing.service.ts");
const { enforceSeatLimit } = await import("../../src/modules/system-admin/entitlement.ts");
const { platformTransaction } = await import("../../src/modules/system-admin/platform-audit.ts");
const { redis } = await import("../../src/lib/redis.ts");

test("MySQL constraints, verification locks, seat limits and immutable platform audit", { timeout: 90000 }, async () => {
  const tag = randomUUID();
  const orgId = `platform-it-org-${tag}`, roleId = `platform-it-role-${tag}`;
  const platformRoleId = `platform-it-global-role-${tag}`, actorId = `platform-it-actor-${tag}`;
  const reason = { reason: "Isolated platform integration fixture", confirm: true };
  try {
    await prisma.organization.create({ data: { id: orgId, name: "Platform billing test fixture", slug: orgId } });
    await prisma.role.createMany({ data: [
      { id: roleId, name: "Admin", organizationId: orgId },
      { id: platformRoleId, name: `Platform fixture ${tag}`, organizationId: null },
    ] });
    await prisma.user.createMany({ data: [
      { id: actorId, email: `${actorId}@example.invalid`, firstName: "Platform", lastName: "Fixture", roleId: platformRoleId, platformRole: "SYSTEM_ADMIN", status: "ACTIVE" },
      { id: `platform-it-owner-${tag}`, email: `owner-${tag}@example.invalid`, firstName: "Owner", lastName: "Fixture", roleId, organizationId: orgId, status: "ACTIVE" },
    ] });
    await requestContext.run({ requestId: `platform-it-${tag}`, userId: actorId }, async () => {
      const plan = await billingService.createPlan({ ...reason, name: `Platform fixture ${tag}`, billingInterval: "YEARLY", price: "2999.00", currency: "PHP", maxActiveUsers: 2, isActive: true });
      const subscription = await billingService.assignSubscription({ ...reason, organizationId: orgId, planId: plan.id });
      const payment = await billingService.recordPayment({ ...reason, subscriptionId: subscription.id,
        amount: "2999.00", currency: "PHP", paymentMethod: "BANK_TRANSFER", paidAt: new Date(),
        referenceNumber: `reference-${tag}`, idempotencyKey: `payment-${tag}` });
      const review = { ...reason, decision: "PAID", evidence: `test-bank-statement:${tag}` };
      const results = await Promise.allSettled([
        billingService.reviewPayment(payment.id, review), billingService.reviewPayment(payment.id, review),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
      await billingService.reviewPayment(payment.id, review);
      assert.equal(await prisma.subscriptionHistory.count({ where: { paymentId: payment.id } }), 1);
      const current = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      assert.equal(current.status, "ACTIVE");
      assert.equal(current.currentPeriodPaymentId, payment.id);
      const expiration = current.expiresAt;
      await billingService.reviewPayment(payment.id, review);
      assert.deepEqual((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).expiresAt, expiration);

      const seats = await Promise.allSettled([1, 2].map((index) => platformTransaction(async (db) => {
        await enforceSeatLimit(db, orgId);
        return db.user.create({ data: { id: `platform-it-seat-${index}-${tag}`, email: `seat-${index}-${tag}@example.invalid`,
          firstName: "Seat", lastName: "Fixture", roleId, organizationId: orgId, status: "ACTIVE" } });
      })));
      assert.equal(seats.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(seats.find((result) => result.status === "rejected").reason.statusCode, 409);
      assert.equal(await prisma.user.count({ where: { organizationId: orgId, status: "ACTIVE", deletedAt: null, platformRole: "NONE" } }), 2);

      const refundInput = { ...reason, evidence: `test-refund-confirmation:${tag}`, idempotencyKey: `refund-${tag}` };
      const refunds = await Promise.allSettled([
        billingService.refundPayment(payment.id, refundInput), billingService.refundPayment(payment.id, refundInput),
      ]);
      assert.equal(refunds.filter((result) => result.status === "fulfilled").length, 2);
      await billingService.refundPayment(payment.id, refundInput);
      assert.equal(await prisma.subscriptionRefund.count({ where: { paymentId: payment.id } }), 1);
      assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).status, "CANCELED");
      const gross = await prisma.subscriptionPayment.aggregate({ where: { organizationId: orgId, status: { in: ["PAID", "REFUNDED"] } }, _sum: { amount: true } });
      const refunded = await prisma.subscriptionRefund.aggregate({ where: { payment: { organizationId: orgId } }, _sum: { amount: true } });
      assert.equal(gross._sum.amount.toFixed(2), "2999.00");
      assert.equal(refunded._sum.amount.toFixed(2), "2999.00");

      const monthlyPlan = await billingService.createPlan({ ...reason, name: `Monthly fixture ${tag}`, billingInterval: "MONTHLY", price: "299.00", currency: "PHP", maxActiveUsers: 2, isActive: true });
      await billingService.changePlan(subscription.id, { ...reason, planId: monthlyPlan.id });
      const monthlyPayment = await billingService.recordPayment({ ...reason, subscriptionId: subscription.id,
        amount: "299.00", currency: "PHP", paymentMethod: "BANK_TRANSFER", paidAt: new Date(),
        referenceNumber: `monthly-reference-${tag}`, idempotencyKey: `monthly-payment-${tag}` });
      await Promise.all([billingService.reviewPayment(monthlyPayment.id, review), billingService.reviewPayment(monthlyPayment.id, review)]);
      const monthlySubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      const verifiedMonthly = await prisma.subscriptionPayment.findUniqueOrThrow({ where: { id: monthlyPayment.id } });
      const { billingPeriod } = await import("../../src/modules/system-admin/billing-policy.ts");
      assert.equal(monthlySubscription.billingInterval, "MONTHLY");
      assert.equal(monthlySubscription.price.toFixed(2), "299.00");
      assert.equal(verifiedMonthly.billingInterval, "MONTHLY");
      assert.deepEqual(monthlySubscription.expiresAt, billingPeriod(verifiedMonthly.verifiedAt, null, "MONTHLY").expiresAt);
      assert.equal(await prisma.subscriptionHistory.count({ where: { paymentId: monthlyPayment.id } }), 1);
      await billingService.refundPayment(monthlyPayment.id, { ...refundInput, idempotencyKey: `monthly-refund-${tag}` });
      assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).status, "CANCELED");

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { scope: "PLATFORM", organizationId: orgId } });
      await assert.rejects(() => prisma.auditLog.update({ where: { id: audit.id }, data: { action: "invalid.edit" } }));
      await assert.rejects(() => prisma.auditLog.delete({ where: { id: audit.id } }));
    });
  } finally {
    // No deletion/reset is attempted: platform audit rows intentionally cannot be removed.
    await prisma.$disconnect();
    redis.disconnect();
  }
});
