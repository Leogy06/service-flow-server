import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";

const databaseName = process.env.DATABASE_NAME ?? "";
if (process.env.NODE_ENV !== "test" || process.env.RUN_DB_PLATFORM_TESTS !== "1" ||
    !/^service_flow_platform_test_[a-z0-9_]+$/.test(databaseName) || process.env.PLATFORM_TEST_DATABASE_NAME !== databaseName ||
    new URL(process.env.DATABASE_URL).pathname !== `/${databaseName}`) throw new Error("Isolated platform test database required");

const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { requestContext } = await import("../../src/lib/requestContext.ts");
const { billingService } = await import("../../src/modules/system-admin/billing.service.ts");
const { operationsService, processPlatformAlerts } = await import("../../src/modules/system-admin/operations.service.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const { authenticate } = await import("../../src/middleware/auth.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { default: platformRoutes } = await import("../../src/modules/system-admin/system-admin.routes.ts");

test("trials enforce one grant, real authentication expiry, no revenue, conversion and admin-only HTTP", { timeout: 90000 }, async () => {
  const tag = randomUUID();
  const reason = { reason: "Isolated free trial verification", confirm: true };
  let server;
  try {
    const org = await prisma.organization.create({ data: { name: "Trial fixture", slug: `trial-${tag}` } });
    const role = await prisma.role.create({ data: { name: "Admin", organizationId: org.id } });
    const globalRole = await prisma.role.create({ data: { name: `Trial operator ${tag}` } });
    const actor = await prisma.user.create({ data: { email: `trial-admin-${tag}@example.invalid`, firstName: "Trial", lastName: "Operator", roleId: globalRole.id, status: "ACTIVE", platformRole: "SYSTEM_ADMIN" } });
    const tenant = await prisma.user.create({ data: { email: `trial-owner-${tag}@example.invalid`, firstName: "Trial", lastName: "Owner", roleId: role.id, organizationId: org.id, status: "ACTIVE" } });
    const tenantToken = generateAccessToken({ ...tenant, role: role.name, permissions: [] });
    const actorToken = generateAccessToken({ ...actor, role: globalRole.name, permissions: [] });
    const app = express();
    app.use(express.json(), withRequestContext);
    app.use("/system-admin", platformRoutes);
    app.get("/tenant", authenticate, (_req, res) => res.json({ ok: true }));
    app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" }));
    server = createServer(app);
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${server.address().port}`;
    const tenantRequest = () => fetch(`${base}/tenant`, { headers: { Authorization: `Bearer ${tenantToken}` } });

    await requestContext.run({ requestId: `trial-${tag}`, userId: actor.id }, async () => {
      const plan = await billingService.createPlan({ ...reason, name: `Trial plan ${tag}`, price: "299.00", billingInterval: "MONTHLY", currency: "PHP", maxActiveUsers: 1, isActive: true });
      const before = await operationsService.dashboard({});
      const subscription = await billingService.assignSubscription({ ...reason, organizationId: org.id, planId: plan.id });
      assert.equal((await tenantRequest()).status, 403);
      const grants = await Promise.allSettled([billingService.startTrial(subscription.id, reason), billingService.startTrial(subscription.id, reason)]);
      assert.equal(grants.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(grants.find((item) => item.status === "rejected").reason.statusCode, 409);
      const trial = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      assert.equal(trial.status, "TRIALING");
      assert.equal(+trial.trialExpiresAt - +trial.trialStartedAt, 14 * 86400000);
      assert.equal((await tenantRequest()).status, 200);
      assert.equal(await prisma.subscriptionPayment.count({ where: { organizationId: org.id } }), 0);
      const after = await operationsService.dashboard({});
      assert.equal(after.metrics.activeTrials, before.metrics.activeTrials + 1);
      assert.deepEqual(after.revenue, before.revenue);
      assert.equal(await prisma.subscriptionHistory.count({ where: { subscriptionId: subscription.id, kind: "TRIAL_STARTED" } }), 1);

      const trialUrl = `${base}/system-admin/subscriptions/${subscription.id}/trial`;
      const post = (token, body = reason) => fetch(trialUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      assert.equal((await post()).status, 401);
      assert.equal((await post(tenantToken)).status, 403);
      assert.equal((await post(actorToken, { ...reason, trialDays: 365 })).status, 400);
      assert.equal((await post(actorToken)).status, 409);

      // Authentication must deny expired trials before any scheduler scan.
      const expiredAt = new Date(Date.now() - 1000);
      await prisma.subscription.update({ where: { id: subscription.id }, data: { expiresAt: expiredAt, trialExpiresAt: expiredAt } });
      assert.equal((await tenantRequest()).status, 403);
      const scan = async () => { let cursor; do { const result = await processPlatformAlerts(cursor); cursor = result.nextCursor ?? undefined; } while (cursor); };
      await scan();
      assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).status, "EXPIRED");
      assert.equal(await prisma.platformAlert.count({ where: { targetId: subscription.id, kind: "TRIAL_EXPIRED", resolvedAt: null } }), 1);
      await scan();
      assert.equal(await prisma.subscriptionHistory.count({ where: { subscriptionId: subscription.id, kind: "EXPIRED" } }), 1);
      await assert.rejects(() => billingService.startTrial(subscription.id, reason), { statusCode: 409 });

      const payment = await billingService.recordPayment({ ...reason, subscriptionId: subscription.id, amount: "299.00", currency: "PHP", paymentMethod: "BANK_TRANSFER", referenceNumber: `trial-ref-${tag}`, idempotencyKey: `trial-pay-${tag}`, paidAt: new Date() });
      await billingService.reviewPayment(payment.id, { ...reason, decision: "PAID", evidence: `trial-evidence-${tag}` });
      const converted = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      assert.equal(converted.status, "ACTIVE");
      assert.equal(converted.billingInterval, "MONTHLY");
      assert.deepEqual(converted.trialStartedAt, trial.trialStartedAt);
      assert.equal((await tenantRequest()).status, 200);
      await scan();
      assert.equal(await prisma.platformAlert.count({ where: { targetId: subscription.id, kind: "TRIAL_EXPIRED", resolvedAt: null } }), 0);
      await billingService.refundPayment(payment.id, { ...reason, evidence: "isolated-trial-refund", idempotencyKey: `trial-refund-${tag}` });
      assert.equal((await tenantRequest()).status, 403);
      await assert.rejects(() => billingService.startTrial(subscription.id, reason), { statusCode: 409 });

      const initialOrg = await prisma.organization.create({ data: { name: "Initial trial fixture", slug: `trial-initial-${tag}` } });
      const initialTrial = await billingService.assignSubscription({ ...reason, organizationId: initialOrg.id, planId: plan.id, startTrial: true });
      assert.equal(initialTrial.status, "TRIALING");
      assert.equal(await prisma.subscriptionPayment.count({ where: { organizationId: initialOrg.id } }), 0);
      await assert.rejects(() => billingService.assignSubscription({ ...reason, organizationId: initialOrg.id, planId: plan.id, startTrial: true }), { statusCode: 409 });
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    await prisma.$disconnect();
    redis.disconnect();
  }
});
