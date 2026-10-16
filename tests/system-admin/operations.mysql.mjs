// Run after mysql.integration.mjs using its isolated environment and applied migrations.
import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const name = process.env.DATABASE_NAME ?? "";
if (process.env.NODE_ENV !== "test" || process.env.RUN_DB_PLATFORM_TESTS !== "1" ||
  !/^service_flow_platform_test_[a-z0-9_]+$/.test(name) || process.env.PLATFORM_TEST_DATABASE_NAME !== name ||
  new URL(process.env.DATABASE_URL).pathname !== `/${name}`) throw new Error("Isolated platform test database required");
const { prisma } = await import("../../src/lib/prisma.ts");
const { requestContext } = await import("../../src/lib/requestContext.ts");
const { operationsService, processPlatformAlerts, recordPlatformServerError } = await import("../../src/modules/system-admin/operations.service.ts");
const { observeRequests, onPlatformServerError, trafficSnapshot } = await import("../../src/modules/system-admin/telemetry.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { billingService } = await import("../../src/modules/system-admin/billing.service.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const { createServer } = await import("node:http");
const express = (await import("express")).default;
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { default: platformRoutes } = await import("../../src/modules/system-admin/system-admin.routes.ts");

test("real operations records, dashboard/refund reporting, alerts deduplication, and platform HTTP protection", { timeout: 90000 }, async () => {
  const tag = randomUUID();
  let server;
  try {
    const role = await prisma.role.create({ data: { name: `Platform operations ${tag}` } });
    const actor = await prisma.user.create({ data: { email: `operations-${tag}@example.invalid`, firstName: "Operations", lastName: "Fixture", roleId: role.id, platformRole: "SYSTEM_ADMIN", status: "ACTIVE" } });
    const org = await prisma.organization.create({ data: { name: "=CSV operations fixture", slug: `operations-${tag}` } });
    const tenantRole = await prisma.role.create({ data: { name: "Admin", organizationId: org.id } });
    const tenant = await prisma.user.create({ data: { email: `tenant-${tag}@example.invalid`, firstName: "Tenant", lastName: "Fixture", roleId: tenantRole.id, organizationId: org.id, status: "ACTIVE" } });
    await requestContext.run({ requestId: `operations-${tag}`, userId: actor.id }, async () => {
      const before = await operationsService.dashboard({});
      const plan = await billingService.createPlan({ name: `Operations plan ${tag}`, annualPrice: "123.45", currency: "PHP", maxActiveUsers: 3, isActive: true, confirm: true, reason: "Isolated operations test" });
      const sub = await billingService.assignSubscription({ organizationId: org.id, planId: plan.id, confirm: true, reason: "Isolated operations test" });
      const p = await billingService.recordPayment({ subscriptionId: sub.id, amount: "123.45", currency: "PHP", paymentMethod: "BANK_TRANSFER", referenceNumber: `ops-ref-${tag}`, idempotencyKey: `ops-pay-${tag}`, paidAt: new Date(), confirm: true, reason: "Isolated operations test" });
      await billingService.reviewPayment(p.id, { decision: "PAID", evidence: "isolated-trusted-evidence", confirm: true, reason: "Isolated verification test" });
      await billingService.refundPayment(p.id, { evidence: "isolated-confirmed-refund", idempotencyKey: `ops-refund-${tag}`, confirm: true, reason: "Isolated refund test" });
      const after = await operationsService.dashboard({});
      const previous = before.revenue.find((r) => r.currency === "PHP") ?? { gross: "0", refunds: "0", net: "0" };
      const current = after.revenue.find((r) => r.currency === "PHP");
      assert.equal(Math.round((Number(current.gross) - Number(previous.gross)) * 100), 12345);
      assert.equal(Math.round((Number(current.refunds) - Number(previous.refunds)) * 100), 12345);
      assert.equal(current.net, previous.net);
      assert.ok(after.metrics.newTenantRegistrations > 0);
      assert.ok(after.registrationTrend.some((r) => r.count > 0));
      const csv = await operationsService.billingReport({});
      assert.ok(csv.csv.includes('"\'=CSV operations fixture"'));
      assert.ok(csv.csv.includes(`ops-ref-${tag}`));
      assert.ok(csv.csv.includes('"REFUND"'));

      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", startsAt: new Date(Date.now() - 400 * 86400000), expiresAt: new Date(Date.now() - 86400000) } });
      const scan = async () => { let cursor; let batches = 0; do { const result = await processPlatformAlerts(cursor); cursor = result.nextCursor ?? undefined; assert.ok(++batches < 100); } while (cursor); };
      await scan();
      assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status, "EXPIRED");
      const count = await prisma.platformAlert.count({ where: { targetId: sub.id } });
      assert.equal(count, 1);
      await scan();
      assert.equal(await prisma.platformAlert.count({ where: { targetId: sub.id } }), count);
      assert.equal(await prisma.subscriptionHistory.count({ where: { subscriptionId: sub.id, kind: "EXPIRED" } }), 1);
    });

    onPlatformServerError(recordPlatformServerError);
    const app = express(); app.use(express.json(), withRequestContext, observeRequests); app.use("/system-admin", platformRoutes);
    app.get("/synthetic-error", (_req, res) => res.status(500).json({ error: "Simulated isolated test error" }));
    app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" }));
    server = createServer(app); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/system-admin`;
    const platformToken = generateAccessToken({ ...actor, role: "ordinary-role", organizationId: null, permissions: [] });
    const tenantToken = generateAccessToken({ ...tenant, role: "SYSTEM_ADMIN", permissions: ["system-admin:update"] });
    assert.equal((await fetch(`${base}/plans`)).status, 401);
    // Even a validly signed token claiming a platform role cannot override its database identity.
    assert.equal((await fetch(`${base}/plans`, { headers: { Authorization: `Bearer ${tenantToken}` } })).status, 403);
    const response = await fetch(`${base}/dashboard`, { headers: { Authorization: `Bearer ${platformToken}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const health = await fetch(`${base}/monitoring`, { headers: { Authorization: `Bearer ${platformToken}` } });
    assert.equal(health.status, 200);
    const payload = await health.json();
    assert.equal(payload.data.services.database.status, "up");
    assert.equal(payload.data.databaseStorageBytes, null);
    assert.ok(!JSON.stringify(payload).includes(process.env.DATABASE_PASSWORD));
    await fetch(`http://127.0.0.1:${server.address().port}/synthetic-error`);
    await fetch(`http://127.0.0.1:${server.address().port}/synthetic-error`);
    const instance = trafficSnapshot().instanceId;
    let errorAlert;
    for (let attempt = 0; attempt < 50; attempt++) {
      errorAlert = await prisma.platformAlert.findFirst({ where: { kind: "PLATFORM_ERROR", targetId: instance } });
      if (errorAlert) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(errorAlert);
    assert.equal(await prisma.platformAlert.count({ where: { kind: "PLATFORM_ERROR", targetId: instance } }), 1);
    assert.ok(!errorAlert.message.includes("Simulated isolated test error"));
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await prisma.$disconnect(); redis.disconnect();
  }
});
