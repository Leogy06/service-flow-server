import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import mariadb from "mariadb";

const database = process.env.DATABASE_NAME ?? "";
if (process.env.NODE_ENV !== "test" || process.env.RUN_DB_PLATFORM_TESTS !== "1" ||
    !/^service_flow_platform_test_provisioning_[a-z0-9_]+$/.test(database) ||
    process.env.PLATFORM_TEST_DATABASE_NAME !== database || new URL(process.env.DATABASE_URL).pathname !== `/${database}` ||
    !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Explicit disposable local provisioning database required");
}
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { requestContext } = await import("../../src/lib/requestContext.ts");
const { createProvisioningService } = await import("../../src/modules/system-admin/provisioning/provisioning.service.ts");
const { DEFAULT_ROLE_DEFINITIONS } = await import("../../src/constants/default-roles.ts");
const { userService } = await import("../../src/modules/user/user.service.ts");
const { paymentService } = await import("../../src/modules/payment/payment.service.ts");
const { organizationPageService } = await import("../../src/modules/organization/page.service.ts");
const { billingService } = await import("../../src/modules/system-admin/billing.service.ts");
const deliveries = [];
const service = createProvisioningService({ sendInvitation: async input => { deliveries.push(input); return { id: randomUUID() }; } });
const failedDelivery = createProvisioningService({ sendInvitation: async () => { throw new Error("Synthetic private provider error"); } });
const action = { reason: "Isolated sample environment verification", confirm: true };
const tag = randomUUID().slice(0, 8);
const expectConflict = error => error.statusCode === 409;
function pass(name) { console.log(`PASS ${name}`); }
try {
  for (const name of new Set(DEFAULT_ROLE_DEFINITIONS.flatMap(role => [...role.permissionNames]))) {
    await prisma.permission.upsert({ where: { name }, update: {}, create: { name } });
  }
  const operatorRole = await prisma.role.create({ data: { name: `Onboarding operator ${tag}` } });
  const actor = await prisma.user.create({ data: { email: `operator-${tag}@example.invalid`, firstName: "Test", lastName: "Operator", roleId: operatorRole.id, status: "ACTIVE", platformRole: "SYSTEM_ADMIN" } });
  const plan = await prisma.plan.create({ data: { name: `Onboarding plan ${tag}`, price: "999.00", currency: "PHP", maxActiveUsers: 5, isActive: true, billingInterval: "MONTHLY" } });
  const foreign = await prisma.organization.create({ data: { name: "Untouched existing business", slug: `untouched-${tag}` } });
  const sentinel = await prisma.customer.create({ data: { organizationId: foreign.id, name: "Retained existing customer", email: "retained@example.invalid", phoneNumber: "00000000001" } });
  const asOperator = work => requestContext.run({ requestId: `onboarding-${tag}`, userId: actor.id }, work);
  const input = (suffix, mode = "DEMO") => ({
    idempotencyKey: randomUUID(), templateId: "AIRCON", mode,
    organization: { name: `Fictional Cooling ${suffix}`, slug: `cooling-${tag}-${suffix}` },
    owner: { firstName: "Marina", lastName: "Santos", email: `owner-${tag}-${suffix}@example.invalid` },
    includeDemoData: mode === "DEMO", generateWebsite: true,
    ...(mode === "REAL" ? { planId: plan.id, startTrial: true } : {}), ...action,
  });
  const demoInput = input("demo");
  const concurrent = await asOperator(() => Promise.all([service.create(demoInput), service.create(demoInput)]));
  // A replay can return while the committing request is still delivering mail.
  const demo = await asOperator(() => service.get(concurrent[0].id));
  assert.equal(concurrent[1].id, demo.id);
  assert.equal(await prisma.organization.count({ where: { slug: demoInput.organization.slug } }), 1);
  assert.equal(await prisma.tenantProvisioning.count({ where: { organizationId: demo.organization.id } }), 1);
  assert.equal(deliveries.filter(item => item.to === demoInput.owner.email).length, 1);
  assert.equal(demo.organization.isDemo, true);
  assert.equal(demo.organization.billingEnabled, false);
  assert.equal(await prisma.subscription.count({ where: { organizationId: demo.organization.id } }), 0);
  assert.equal(demo.invitationStatus, "SENT");
  const savedOwner = await prisma.user.findUniqueOrThrow({ where: { id: demo.owner.id } });
  const demoMail = deliveries.find(item => item.to === savedOwner.email);
  assert.equal(savedOwner.password, null);
  assert.equal(savedOwner.status, "PENDING");
  assert.equal(savedOwner.inviteToken, createHash("sha256").update(demoMail.token).digest("hex"));
  assert.ok(!JSON.stringify(demo).includes(demoMail.token));
  assert.ok(!JSON.stringify(demo).includes(savedOwner.inviteToken));
  pass("concurrent retry commits one isolated demo and sends one hashed-token owner invitation");

  const services = await prisma.serviceType.findMany({ where: { organizationId: demo.organization.id } });
  assert.ok(services.length >= 5);
  assert.ok(services.every(row => row.basePrice.eq(0) && !row.isActive && /confirm|pricing/i.test(row.description)));
  const roles = await prisma.role.findMany({ where: { organizationId: demo.organization.id }, include: { permissions: { include: { permission: true } } } });
  assert.deepEqual(roles.map(row => row.name).sort(), ["Admin", "Manager", "Staff"]);
  for (const definition of DEFAULT_ROLE_DEFINITIONS) {
    const role = roles.find(row => row.name === definition.name);
    assert.deepEqual(new Set(role.permissions.filter(grant => grant.isActive).map(grant => grant.permission.name)), new Set(definition.permissionNames));
  }
  const page = await prisma.organizationPage.findUniqueOrThrow({ where: { organizationId: demo.organization.id } });
  assert.equal(page.publishedAt, null);
  assert.equal(page.published, null);
  assert.equal(page.draft.email, "");
  const invoices = await prisma.invoice.findMany({ where: { organizationId: demo.organization.id }, include: { items: true, payments: true, job: true } });
  assert.ok(invoices.length > 0);
  for (const invoice of invoices) {
    assert.ok(invoice.items.length > 0);
    assert.ok(invoice.total.eq(invoice.items.reduce((total, item) => total.add(item.amount), invoice.total.mul(0))));
    assert.equal(invoice.job.organizationId, demo.organization.id);
    assert.equal(invoice.job.status, "COMPLETED");
    assert.ok(invoice.payments.every(payment => payment.notes.includes("No money was collected")));
    assert.ok(invoice.amountPaid.eq(invoice.payments.reduce((total, payment) => total.add(payment.amount), invoice.total.mul(0))));
  }
  assert.ok(await prisma.jobStatusHistory.count({ where: { job: { organizationId: demo.organization.id } } }) > 0);
  await assert.rejects(asOperator(() => service.create({ ...demoInput, organization: { ...demoInput.organization, name: "Changed request" } })), expectConflict);
  pass("industry catalog, scoped role defaults, draft content, invoice integrity and changed-key rejection");

  const tenantContext = work => requestContext.run({ requestId: `demo-${tag}`, userId: savedOwner.id, organizationId: demo.organization.id, role: "Admin", permissions: [] }, work);
  await assert.rejects(tenantContext(() => service.templates()), error => error.statusCode === 403);
  await assert.rejects(tenantContext(() => paymentService.record(invoices[0].id, { amount: "1.00", method: "CASH", idempotencyKey: randomUUID(), notes: "", referenceNumber: "" })), error => error.statusCode === 403);
  await assert.rejects(organizationPageService.publicPage(demo.organization.slug), error => error.statusCode === 404);
  await assert.rejects(asOperator(() => billingService.assignSubscription({ organizationId: demo.organization.id, planId: plan.id, startTrial: true, ...action })), error => error.statusCode === 403);
  pass("actual persisted demo boundary denies tenant provisioning, payment, public publication and paid subscription enrollment");

  const realInput = input("real", "REAL");
  const real = await asOperator(() => service.create(realInput));
  assert.equal(real.organization.isDemo, false);
  assert.equal(real.organization.billingEnabled, true);
  assert.equal(await prisma.customer.count({ where: { organizationId: real.organization.id } }), 0);
  assert.equal(await prisma.invoice.count({ where: { organizationId: real.organization.id } }), 0);
  const trial = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: real.organization.id } });
  assert.equal(trial.status, "TRIALING");
  assert.equal(+trial.trialExpiresAt - +trial.trialStartedAt, 14 * 86400000);
  await asOperator(() => service.resendInvitation(real.id, action));
  assert.equal(+(await prisma.subscription.findUniqueOrThrow({ where: { organizationId: real.organization.id } })).trialStartedAt, +trial.trialStartedAt);
  const realMail = deliveries.filter(item => item.to === realInput.owner.email).at(-1);
  await userService.setPassword({ email: realInput.owner.email, token: realMail.token, password: "SyntheticOwnerPassword123!", confirmPassword: "SyntheticOwnerPassword123!" });
  const activated = await prisma.user.findUniqueOrThrow({ where: { id: real.owner.id } });
  assert.equal(activated.status, "ACTIVE");
  assert.equal(activated.inviteToken, null);
  assert.notEqual(activated.password, "SyntheticOwnerPassword123!");
  await assert.rejects(asOperator(() => service.resetDemo(real.id, action)), expectConflict);
  pass("real provisioning has no sample finances, preserves exact 14-day policy and accepts owner invitation securely");

  const failedInput = input("mail-failed", "REAL");
  const failed = await asOperator(() => failedDelivery.create(failedInput));
  assert.equal(failed.invitationStatus, "FAILED");
  assert.ok(!JSON.stringify(failed).includes("Synthetic private"));
  const recovered = await asOperator(() => service.resendInvitation(failed.id, action));
  assert.equal(recovered.invitationStatus, "SENT");
  assert.equal(recovered.organization.id, failed.organization.id);
  pass("email failure retains atomic workspace and recoverable delivery without provider details");

  const retained = await prisma.customer.create({ data: { organizationId: demo.organization.id, name: "DEMO additional fictional customer", email: `extra-${tag}@example.invalid`, phoneNumber: "00000000002" } });
  const reset = await asOperator(() => service.resetDemo(demo.id, action));
  assert.equal(reset.counts.invoices, demo.counts.invoices);
  assert.ok(await prisma.customer.findUnique({ where: { id: retained.id } }));
  assert.ok(await prisma.customer.findUnique({ where: { id: sentinel.id } }));
  pass("manifest-scoped sample reset preserves custom demo records and another tenant");

  const rollbackInput = input("rollback");
  // MySQL trigger DDL uses the text protocol; prepared statements reject it.
  const mysqlUrl = new URL(process.env.DATABASE_URL);
  const triggerConnection = await mariadb.createConnection({ host: mysqlUrl.hostname, port: Number(mysqlUrl.port),
    user: decodeURIComponent(mysqlUrl.username), password: decodeURIComponent(mysqlUrl.password), database, allowPublicKeyRetrieval: true });
  await triggerConnection.query("CREATE TRIGGER onboarding_test_failure BEFORE INSERT ON `ServiceType` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic test rollback'");
  try {
    await assert.rejects(asOperator(() => service.create(rollbackInput)));
  } finally {
    await triggerConnection.query("DROP TRIGGER onboarding_test_failure");
    await triggerConnection.end();
  }
  assert.equal(await prisma.organization.count({ where: { slug: rollbackInput.organization.slug } }), 0);
  assert.equal(await prisma.user.count({ where: { email: rollbackInput.owner.email } }), 0);
  await asOperator(() => service.create(rollbackInput));
  assert.equal(await prisma.organization.count({ where: { slug: rollbackInput.organization.slug } }), 1);
  pass("real MySQL failure rolls back all setup and retry succeeds without partial resources");
} finally {
  await prisma.$disconnect();
  redis.disconnect();
}
