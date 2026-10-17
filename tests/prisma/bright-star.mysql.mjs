// Local, opt-in verification. --rollback-check exercises the complete batch and
// deliberately aborts its transaction. --apply-and-verify commits after proving
// existing rows are preserved. Default mode only verifies an applied batch.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { argv } from "node:process";
import { log } from "node:console";
import { prisma } from "../../src/lib/prisma.ts";
import { redis } from "../../src/lib/redis.ts";
import { env } from "../../src/config/env.ts";
import { brightStarId, inspectBrightStarSeed, seedBrightStar } from "../../prisma/seeds/bright-star.ts";
import { BRIGHT_STAR_SEED, brightStarCustomers, brightStarScenarios } from "../../prisma/seeds/bright-star-data.ts";
import { checkJobTransition } from "../../src/modules/job/lifecycle.ts";
import { dashboardService } from "../../src/modules/dashboard/dashboard.service.ts";
import { requestContext } from "../../src/lib/requestContext.ts";
import { authorizationSelect, resolvePermissions } from "../../src/modules/auth/authorization.ts";
import { invalidateModuleCache } from "../../src/utils/module-cache.ts";
import { Prisma } from "../../src/generated/prisma/client.ts";

const digest = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const sum = (rows, field) => rows.reduce((total, row) => total.add(row[field]), new Prisma.Decimal(0));
const models = ["organization", "organizationSettings", "user", "role", "rolePermission", "userPermission", "permission", "subscription", "subscriptionPayment", "subscriptionHistory", "customer", "serviceType", "serviceRequest", "job", "jobStatusHistory", "invoice", "invoiceItem", "payment", "feedbackInvitation", "customerFeedback", "productFeedback", "auditLog"];
const snapshot = async () => Object.fromEntries(await Promise.all(models.map(async (model) =>
  // Digests prove preservation without printing any account or customer data.
  [model, digest(await prisma[model].findMany({ orderBy: model === "organizationSettings" ? { organizationId: "asc" } : { id: "asc" } }))])));
const rowSnapshot = async () => Object.fromEntries(await Promise.all(models.map(async (model) =>
  [model, Object.fromEntries((await prisma[model].findMany()).map((row) => [row.id ?? row.organizationId, digest(row)]))])));

try {
  assert.notEqual(env.NODE_ENV, "production", "Local development verification only");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(env.DATABASE_HOST), "Local database required");
  const flags = argv.slice(2);
  assert.ok(flags.length <= 1 && flags.every((flag) => ["--rollback-check", "--apply-and-verify"].includes(flag)), "Choose --rollback-check, --apply-and-verify, or no flag");
  let target = await inspectBrightStarSeed(prisma);
  const organizationId = target.organization.id;
  if (flags.includes("--rollback-check")) {
    assert.equal(target.marker, null, "Run the rollback check before applying this batch");
    const before = await snapshot();
    const abort = new Error("Expected rollback verification");
    const client = { $transaction: (work, options) => prisma.$transaction(async (db) => {
      const result = await work(db);
      assert.equal(result.status, "created");
      assert.equal(result.summary.serviceRequests, 25);
      throw abort;
    }, options) };
    await assert.rejects(seedBrightStar(client), (error) => error === abort);
    assert.deepEqual(await snapshot(), before, "Every existing row must survive a complete batch rollback unchanged");
    log("PASS: complete seed, histories and audits rolled back; all 22 table digests unchanged.");
  } else {
    if (flags.includes("--apply-and-verify")) {
      const before = await rowSnapshot();
      const result = await seedBrightStar(prisma);
      const after = await rowSnapshot();
      for (const [model, rows] of Object.entries(before)) {
        for (const [key, hash] of Object.entries(rows)) assert.equal(after[model][key], hash, `Existing ${model} row was changed`);
      }
      log(`PASS: ${result.status}; all pre-existing rows across 22 tables and every organization preserved.`);
      target = await inspectBrightStarSeed(prisma);
    }
    assert.ok(target.marker, "Apply the demo seed before verification");
    const ids = (kind, keys) => keys.map((key) => brightStarId(organizationId, `${kind}:${key}`));
    const customers = await prisma.customer.findMany({ where: { id: { in: ids("customer", brightStarCustomers.map((_, index) => index)) } } });
    assert.equal(customers.length, 13);
    assert.equal(customers.filter((row) => row.deletedAt).length, 1);
    assert.ok(customers.every((row) => row.organizationId === organizationId && row.email.endsWith(".test")));
    const requests = await prisma.serviceRequest.findMany({ where: { id: { in: ids("request", brightStarScenarios.map((row) => row.key)) } }, include: {
      customer: true, serviceType: true, jobs: { include: { assignedStaff: true, statusHistory: { orderBy: { createdAt: "asc" } }, invoice: { include: { items: true, payments: true } } } },
    } });
    assert.equal(requests.length, 25);
    let jobCount = 0, historyCount = 0, invoiceCount = 0, paymentCount = 0;
    const methods = new Set();
    const seedTime = new Date(target.marker.metadata.anchoredAt);
    for (const request of requests) {
      assert.equal(request.organizationId, organizationId);
      assert.equal(request.customer.organizationId, organizationId);
      assert.equal(request.serviceType.organizationId, organizationId);
      assert.equal(request.customer.deletedAt, null);
      assert.ok(request.createdAt <= request.updatedAt && request.updatedAt <= seedTime);
      if (request.status === "COMPLETED") assert.ok(request.jobs.length && request.jobs.every((job) => job.status === "COMPLETED"));
      if (request.status === "CANCELLED") assert.ok(request.jobs.every((job) => ["COMPLETED", "CANCELLED"].includes(job.status)));
      for (const job of request.jobs) {
        jobCount++;
        assert.equal(job.organizationId, organizationId);
        assert.equal(job.customerId, request.customerId);
        assert.equal(job.serviceTypeId, request.serviceTypeId);
        assert.ok(!job.assignedStaff || job.assignedStaff.organizationId === organizationId);
        assert.equal(job.statusHistory[0].fromStatus, null);
        assert.equal(job.statusHistory[0].toStatus, "ASSIGNED");
        assert.equal(job.statusHistory.at(-1).toStatus, job.status);
        assert.ok(job.createdAt <= job.updatedAt && job.updatedAt <= seedTime);
        for (const [index, history] of job.statusHistory.entries()) {
          historyCount++;
          assert.ok(history.createdAt <= seedTime);
          if (index) {
            assert.equal(history.fromStatus, job.statusHistory[index - 1].toStatus);
            checkJobTransition(history.fromStatus, history.toStatus);
          }
        }
        if (!job.invoice) continue;
        const invoice = job.invoice;
        invoiceCount++;
        assert.equal(request.status, "COMPLETED");
        assert.equal(invoice.organizationId, organizationId);
        assert.equal(invoice.customerId, request.customerId);
        assert.ok(invoice.issuedAt >= request.updatedAt && invoice.issuedAt <= seedTime);
        for (const item of invoice.items) assert.ok(item.amount.eq(item.quantity.mul(item.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)));
        assert.ok(sum(invoice.items, "amount").eq(invoice.total));
        assert.ok(invoice.subtotal.eq(invoice.total));
        assert.ok(sum(invoice.payments, "amount").eq(invoice.amountPaid));
        assert.ok(invoice.amountPaid.lte(invoice.total));
        if (invoice.status === "PAID") assert.ok(invoice.total.eq(invoice.amountPaid));
        if (invoice.status === "PARTIALLY_PAID") assert.ok(invoice.amountPaid.gt(0) && invoice.amountPaid.lt(invoice.total));
        if (["VOID", "UNPAID"].includes(invoice.status)) assert.equal(invoice.payments.length, 0);
        for (const payment of invoice.payments) {
          paymentCount++;
          methods.add(payment.method);
          assert.ok(payment.receivedAt >= invoice.issuedAt && payment.receivedAt <= seedTime);
        }
      }
    }
    assert.equal(jobCount, 25);
    assert.equal(invoiceCount, 12);
    assert.equal(paymentCount, 9);
    assert.equal(methods.size, 5);
    const invitations = await prisma.feedbackInvitation.findMany({ where: { id: { in: ids("invitation", Array.from({ length: 9 }, (_, i) => i)) } }, include: { feedback: true, serviceRequest: { include: { jobs: true } } } });
    assert.equal(invitations.length, 9);
    assert.equal(invitations.filter((row) => row.feedback).length, 6);
    assert.ok(invitations.some((row) => !row.feedback && row.expiresAt < seedTime));
    assert.ok(invitations.some((row) => !row.feedback && row.expiresAt > seedTime));
    for (const invitation of invitations) {
      assert.equal(invitation.organizationId, organizationId);
      assert.equal(invitation.serviceRequest.status, "COMPLETED");
      assert.ok(invitation.serviceRequest.jobs.every((job) => job.status === "COMPLETED"));
      if (invitation.feedback) {
        assert.ok(invitation.feedback.comment.startsWith("[Sample feedback]"));
        assert.equal(invitation.feedback.consentGrantedAt, null);
        assert.equal(invitation.feedback.testimonialApprovedAt, null);
        assert.ok(invitation.feedback.rating >= 1 && invitation.feedback.rating <= 5);
      }
    }
    const audits = await prisma.auditLog.findMany({ where: { organizationId, metadata: { path: "$.source", equals: BRIGHT_STAR_SEED } }, include: { actor: { select: { organizationId: true } } } });
    assert.equal(audits.length, target.marker.metadata.auditLogs);
    for (const audit of audits) {
      assert.equal(audit.metadata.simulated, true);
      assert.ok(!audit.actor || audit.actor.organizationId === organizationId);
      assert.ok(audit.createdAt <= seedTime);
    }
    const before = await snapshot();
    assert.equal((await seedBrightStar(prisma)).status, "already-seeded");
    assert.deepEqual(await snapshot(), before, "Reruns must preserve every row, including user changes");

    await invalidateModuleCache(["customers", "serviceTypes", "jobs", "invoices"], organizationId);
    const dashboards = [];
    for (const actor of [target.admin, target.staff]) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: authorizationSelect });
      const data = await requestContext.run({ requestId: "seed-verification", organizationId, userId: actor.id,
        role: user.role.name, permissions: resolvePermissions(user).names }, () => dashboardService.get());
      assert.ok(data.jobs && data.jobs.completedThisMonth > 0 && data.jobs.overdue > 0 && data.jobs.scheduledToday > 0);
      if (data.mode === "business") {
        assert.ok(data.jobs.readyToInvoice > 0 && data.requests.readyToClose > 0 && data.requests.waitingForAssignment > 0);
        assert.ok(Number(data.billing.collectedThisMonth) > 0 && Number(data.billing.overdueBalance) > 0);
      }
      dashboards.push({ mode: data.mode, jobsCompletedThisMonth: data.jobs.completedThisMonth, scheduledToday: data.jobs.scheduledToday, overdueJobs: data.jobs.overdue });
    }
    log(JSON.stringify({ result: "PASS", requests: requests.length, jobs: jobCount, histories: historyCount, invoices: invoiceCount, payments: paymentCount, auditLogs: audits.length, preservation: "rerun left all 22 table digests unchanged", dashboards }, null, 2));
  }
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
