// Exercise the real batch against local MySQL, then deliberately roll back.
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../src/lib/prisma.ts";
import { redis } from "../../src/lib/redis.ts";
import { env } from "../../src/config/env.ts";
import { Prisma } from "../../src/generated/prisma/client.ts";
import { authorizationSelect, resolvePermissions } from "../../src/modules/auth/authorization.ts";
import { entitlementIsCurrent } from "../../src/modules/system-admin/billing-policy.ts";
import { assertDevelopmentSeedTarget, developmentId } from "../../prisma/seeds/development-data.ts";
import { seedDevelopment } from "../../prisma/seeds/development.ts";
import { seedProduction } from "../../prisma/seeds/production.ts";

const models = Object.values(Prisma.ModelName).map((name) => name[0].toLowerCase() + name.slice(1));
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function snapshot(db) {
  const entries = [];
  for (const model of models) {
    const rows = await db[model].findMany();
    entries.push([model, digest(rows.sort((a, b) => String(a.id ?? a.organizationId).localeCompare(String(b.id ?? b.organizationId))))]);
  }
  return Object.fromEntries(entries);
}
const sum = (rows, field) => rows.reduce((total, row) => total.add(row[field]), new Prisma.Decimal(0));

try {
  assertDevelopmentSeedTarget(env);
  assert.equal(process.argv.length, 2, "This rollback-only check accepts no write flags.");
  assert.equal(await prisma.auditLog.findUnique({ where: { id: developmentId("batch") } }), null,
    "Run this check before applying the development batch, or use a separate empty local database.");
  const before = await snapshot(prisma);
  const rollback = new Error("Expected development seed rollback");
  const password = randomBytes(24).toString("hex") + "Aa1";
  const now = new Date();
  const checkEnvironment = { ...env, DEV_SEED_PASSWORD: password, SALT_ROUNDS: 4 };
  const operatorInput = { SYSTEM_ADMIN_EMAIL: `setup-${randomBytes(8).toString("hex")}@example.test`,
    SYSTEM_ADMIN_PASSWORD: password, SYSTEM_ADMIN_REASON: "Local rollback verification of minimal production setup" };
  const productionClient = { $transaction: (work, options) => prisma.$transaction(async (db) => {
    const setup = await work(db);
    assert.equal(setup.systemAdmin.status, "created");
    const after = await snapshot(db);
    for (const model of models.filter((name) => !["permission", "user", "role", "auditLog"].includes(name))) {
      assert.equal(after[model], before[model], `Production setup must leave ${model} unchanged.`);
    }
    const user = await db.user.findUnique({ where: { email: operatorInput.SYSTEM_ADMIN_EMAIL }, include: { role: true } });
    assert.equal(user.organizationId, null);
    assert.equal(user.role.organizationId, null);
    assert.equal(user.platformRole, "SYSTEM_ADMIN");
    assert.ok(await bcrypt.compare(password, user.password));
    const repeated = await seedProduction({ $transaction: (next) => next(db) }, operatorInput, false);
    assert.equal(repeated.systemAdmin.status, "preserved");
    assert.deepEqual(await snapshot(db), after);
    throw rollback;
  }, options) };
  await assert.rejects(seedProduction(productionClient, operatorInput, false), (error) => error === rollback);
  assert.deepEqual(await snapshot(prisma), before);
  let verified = false;
  const client = { $transaction: (work, options) => prisma.$transaction(async (db) => {
    const result = await work(db);
    assert.equal(result.status, "created");
    assert.equal(result.organizationIds.length, 3);
    const organizations = await db.organization.findMany({ where: { id: { in: result.organizationIds } } });
    const users = await db.user.findMany({ where: { email: { in: result.accounts } }, select: authorizationSelect });
    assert.equal(users.length, 10);
    for (const user of users) {
      assert.equal(user.organizationId, user.role.organizationId);
      if (user.organizationId) {
        assert.equal(user.platformRole, "NONE");
        const effective = resolvePermissions(user).names;
        if (user.role.name === "Admin") assert.ok(effective.includes("customer:create"));
        if (user.role.name === "Staff") assert.ok(!effective.includes("customer:update"));
      } else assert.equal(user.platformRole, "SYSTEM_ADMIN");
      const account = await db.user.findUnique({ where: { id: user.id }, select: { password: true } });
      assert.ok(await bcrypt.compare(password, account.password), "New sample account password must be hashed and usable.");
    }
    const invoices = await db.invoice.findMany({ where: { organizationId: { in: result.organizationIds } },
      include: { items: true, payments: true, customer: true, job: true } });
    assert.ok(invoices.length >= 14);
    for (const invoice of invoices) {
      assert.equal(invoice.customer.organizationId, invoice.organizationId);
      assert.equal(invoice.job.organizationId, invoice.organizationId);
      assert.ok(sum(invoice.items, "amount").eq(invoice.total), "Invoice totals must equal line totals.");
      assert.ok(sum(invoice.payments, "amount").eq(invoice.amountPaid), "Receipts must equal the paid balance.");
      assert.ok(invoice.amountPaid.lte(invoice.total));
      if (invoice.status === "PAID") assert.ok(invoice.amountPaid.eq(invoice.total));
      if (invoice.status === "PARTIALLY_PAID") assert.ok(invoice.amountPaid.gt(0) && invoice.amountPaid.lt(invoice.total));
    }
    const jobs = await db.job.findMany({ where: { organizationId: { in: result.organizationIds } },
      include: { customer: true, serviceType: true, serviceRequest: true, assignedStaff: true, statusHistory: { orderBy: { createdAt: "asc" } } } });
    assert.ok(jobs.length >= 27);
    for (const job of jobs) {
      for (const related of [job.customer, job.serviceType, job.serviceRequest, job.assignedStaff].filter(Boolean)) {
        assert.equal(related.organizationId, job.organizationId);
      }
      assert.equal(job.statusHistory.at(-1).toStatus, job.status);
    }
    const subscriptions = await db.subscription.findMany({ where: { organizationId: { in: result.organizationIds } }, include: { payments: true } });
    assert.equal(subscriptions.length, 3);
    for (const subscription of subscriptions) {
      const organization = organizations.find((org) => org.id === subscription.organizationId);
      if (organization.billingEnabled) assert.ok(entitlementIsCurrent(subscription, 0, now));
      if (subscription.status === "ACTIVE") {
        const receipt = subscription.payments.find((payment) => payment.id === subscription.currentPeriodPaymentId);
        assert.equal(receipt.status, "PAID");
        assert.ok(receipt.amount.eq(subscription.price));
      }
    }
    const feedback = await db.customerFeedback.findMany({ where: { organizationId: { in: result.organizationIds } } });
    assert.ok(feedback.length >= 6);
    assert.ok(feedback.every((row) => row.consentGrantedAt === null && row.testimonialApprovedAt === null));
    // Reuse the same real transaction to prove apply retries do not mutate rows.
    const seeded = await snapshot(db);
    const retry = await seedDevelopment({ $transaction: (next) => next(db) }, checkEnvironment, { dryRun: false, now });
    assert.equal(retry.status, "already-seeded");
    assert.deepEqual(await snapshot(db), seeded);
    verified = true;
    throw rollback;
  }, options) };
  await assert.rejects(seedDevelopment(client, checkEnvironment, { dryRun: false, now }), (error) => error === rollback);
  assert.ok(verified, "The complete batch must reach all assertions before rollback.");
  assert.deepEqual(await snapshot(prisma), before, "Rollback must preserve every pre-existing table row.");
  console.log("Local MySQL verification passed: minimal production setup changes only permissions/operator/role/audits; full development fixtures, permissions/passwords, ownership, balances, histories, billing and idempotency. Both batches rolled back; no data committed.");
} catch (error) {
  console.error("Development MySQL verification failed:", error?.code ?? error?.name ?? "Unknown error");
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
