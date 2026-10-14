// Real frontend Axios clients, protected Express routes, MySQL and Redis.
// Only UUID-scoped fixtures are created and removed.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import process from "node:process";
import express from "express";
import cors from "cors";
const { fetch } = globalThis;

if (process.env.RUN_DB_WORKFLOW_TESTS !== "1" || process.env.NODE_ENV !== "test") throw new Error("Run test:workflow:mysql or test:workflow:browser");
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { authenticate } = await import("../../src/middleware/auth.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { errorHandler } = await import("../../src/middleware/errorHandler.ts");
const { default: jobRoutes } = await import("../../src/modules/job/job.routes.ts");
const { default: invoiceRoutes } = await import("../../src/modules/invoice/invoice.routes.ts");
const { default: requestRoutes } = await import("../../src/modules/service-request/service-request.routes.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const { auditService } = await import("../../src/modules/audit/audit.service.ts");
const { PERMISSIONS: P } = await import("../../src/constants/permission.constants.ts");

test("request -> assigned jobs -> completion -> invoice -> payments", { timeout: process.env.RUN_BROWSER_WORKFLOW_TESTS === "1" ? 300000 : 90000 }, async (t) => {
  const tag = randomUUID();
  const orgA = `wf-a-${tag}`, orgB = `wf-b-${tag}`, orgIds = [orgA, orgB];
  const admin = `wf-admin-${tag}`, staff = `wf-staff-${tag}`, reader = `wf-reader-${tag}`, foreign = `wf-foreign-${tag}`, inactive = `wf-inactive-${tag}`;
  const adminRole = `wf-ar-${tag}`, staffRole = `wf-sr-${tag}`, readerRole = `wf-rr-${tag}`, foreignRole = `wf-fr-${tag}`;
  const roleIds = [adminRole, staffRole, readerRole, foreignRole], userIds = [admin, staff, reader, foreign, inactive];
  const customerA = `wf-ca-${tag}`, customerB = `wf-cb-${tag}`, typeA = `wf-ta-${tag}`, typeB = `wf-tb-${tag}`;
  const createdPermissions = [], permissionIds = {}, testIps = new Set();
  const originalAudit = auditService.recordInTransaction;
  const server = createServer();
  let browserMode = false, dropPaymentResponse = false, tokenA;
  try {
    await redis.ping();
    const allPermissions = [P.SERVICE_REQUEST_READ, P.SERVICE_REQUEST_CREATE, P.SERVICE_REQUEST_UPDATE, P.JOB_READ, P.JOB_CREATE, P.JOB_UPDATE, P.JOB_DELETE,
      P.INVOICE_READ, P.INVOICE_CREATE, P.INVOICE_UPDATE, P.INVOICE_DELETE];
    for (const name of allPermissions) {
      let row = await prisma.permission.findUnique({ where: { name } });
      if (row?.organizationId) throw new Error("Tests require global workflow permission definitions");
      if (!row) { row = await prisma.permission.create({ data: { name } }); createdPermissions.push(row.id); }
      permissionIds[name] = row.id;
    }
    await prisma.organization.createMany({ data: orgIds.map((id) => ({ id, slug: id, name: "Temporary workflow test" })) });
    await prisma.role.createMany({ data: [
      { id: adminRole, organizationId: orgA, name: "Admin" }, { id: staffRole, organizationId: orgA, name: "Technician" },
      { id: readerRole, organizationId: orgA, name: "Reader" }, { id: foreignRole, organizationId: orgB, name: "Admin" },
    ] });
    await prisma.rolePermission.createMany({ data: [
      ...[adminRole, foreignRole].flatMap((roleId) => Object.values(permissionIds).map((permissionId) => ({ roleId, permissionId }))),
      ...[P.JOB_READ, P.JOB_UPDATE].map((name) => ({ roleId: staffRole, permissionId: permissionIds[name] })),
      ...[P.JOB_READ, P.INVOICE_READ, P.SERVICE_REQUEST_READ].map((name) => ({ roleId: readerRole, permissionId: permissionIds[name] })),
    ] });
    await prisma.user.createMany({ data: [
      { id: admin, organizationId: orgA, roleId: adminRole }, { id: staff, organizationId: orgA, roleId: staffRole },
      { id: reader, organizationId: orgA, roleId: readerRole }, { id: foreign, organizationId: orgB, roleId: foreignRole },
      { id: inactive, organizationId: orgA, roleId: staffRole, status: "PENDING" },
    ].map((row) => ({ status: "ACTIVE", ...row, firstName: row.id === staff ? "Technician" : "Fixture", lastName: "Member", email: `${row.id}@example.invalid` })) });
    await prisma.customer.createMany({ data: [customerA, customerB].map((id, i) => ({ id, organizationId: orgIds[i], name: id, email: `${id}@example.invalid`, phoneNumber: `wf-${tag}-${i}` })) });
    await prisma.serviceType.createMany({ data: [typeA, typeB].map((id, i) => ({ id, organizationId: orgIds[i], name: "Fixture repair", basePrice: "100.25" })) });
    const token = (id, organizationId) => generateAccessToken({ id, organizationId, role: "Fixture", firstName: "Test", lastName: "Member", email: `${id}@example.invalid`, permissions: [] });
    tokenA = token(admin, orgA);
    const tokenB = token(foreign, orgB), staffToken = token(staff, orgA), readerToken = token(reader, orgA);
    const app = express();
    // Private test listener: fixtures are still loaded through real authenticate middleware.
    app.use((req, res, next) => {
      let ip; do { ip = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`; } while (testIps.has(ip));
      testIps.add(ip); req.headers["x-forwarded-for"] = ip;
      if (browserMode) req.headers.authorization = `Bearer ${tokenA}`;
      if (dropPaymentResponse && req.method === "POST" && /\/invoices\/[^/]+\/payments$/.test(req.path)) {
        dropPaymentResponse = false;
        // Simulate a gateway losing the success confirmation after the payment commits.
        // A 502 avoids the browser's automatic retry of a dropped HTTP connection.
        const originalJson = res.json.bind(res);
        res.json = () => { res.status(502); return originalJson({ error: "Payment confirmation unavailable" }); };
      }
      next();
    });
    app.set("trust proxy", "loopback");
    app.use(cors({ origin: /^http:\/\/localhost:\d+$/, credentials: true }), express.json(), withRequestContext);
    app.get("/api/auth/me", authenticate, (req, res) => res.json({ data: req.user }));
    app.get("/api/organization/check-slug/:slug", (req, res) => req.params.slug === orgA ? res.json({ data: { id: orgA, slug: orgA, name: "Fixture organization" } }) : res.status(404).json({ error: "Not found" }));
    app.use("/api/jobs", authenticate, jobRoutes);
    app.use("/api/invoices", authenticate, invoiceRoutes);
    app.use("/api/service-requests", authenticate, requestRoutes);
    app.use(errorHandler);
    server.on("request", app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${server.address().port}/api`;
    const { api, setAccessToken } = await import("../../../frontend/app/lib/api/client.ts");
    const { jobApi: jobs, invoiceApi: invoices } = await import("../../../frontend/features/workflow/api.ts");
    const { serviceRequestApi: requests } = await import("../../../frontend/features/service-requests/api/service-request-api.ts");
    const safe = async (work) => {
      try { return await work(); } catch (error) { const clean = new Error(error.response?.data?.error ?? "HTTP request failed"); clean.status = error.response?.status; throw clean; }
    };
    const as = (accessToken, work) => { setAccessToken(accessToken); return safe(work); };
    const denied = (work, status) => assert.rejects(work, (error) => error.status === status);
    const listParams = { page: 1, pageSize: 10, search: "", sortOrder: "desc" };
    const requestInput = (title) => ({ title, customerId: customerA, serviceTypeId: typeA, description: "Workflow fixture", priority: "NORMAL" });
    const firstRequest = await as(tokenA, () => requests.create(requestInput("Workflow test request")));
    const otherRequest = await as(tokenA, () => requests.create(requestInput("Other workflow request")));
    const jobInput = (requestId = firstRequest.id) => ({ serviceRequestId: requestId, assignedStaffId: staff, description: "Repair work", location: "Manila", internalNotes: "Fixture notes", scheduledStart: null, scheduledEnd: null });
    const invoiceInput = (jobId, unitPrice = "100.00") => ({ jobId, items: [{ description: "Completed service", quantity: "1", unitPrice }], dueAt: null, notes: "Fixture invoice" });
    const payment = (amount, options = {}) => ({ idempotencyKey: randomUUID(), amount, method: "CASH", referenceNumber: "", notes: "", ...options });
    let firstJob, secondJob, thirdJob, invoiceA, invoiceB, invoiceC;
    await t.test("creates owned jobs, validates assignment and ignores client relationship overrides", async () => {
      firstJob = await as(tokenA, () => jobs.create(jobInput()));
      const injected = await as(tokenA, () => api.post("/jobs", { ...jobInput(), organizationId: orgB, customerId: customerB, serviceTypeId: typeB, status: "COMPLETED", referenceNumber: "client" }));
      secondJob = injected.data.data;
      assert.equal(secondJob.status, "ASSIGNED"); assert.equal(secondJob.customer.id, customerA); assert.equal(secondJob.serviceType.id, typeA);
      assert.notEqual(secondJob.referenceNumber, "client");
      assert.equal((await prisma.job.findUnique({ where: { id: secondJob.id } })).organizationId, orgA);
      assert.equal((await as(tokenA, () => jobs.get(firstJob.id))).statusHistory.length, 1);
      for (const bad of [{ serviceRequestId: "foreign-request" }, { assignedStaffId: foreign }, { assignedStaffId: inactive }]) {
        await denied(() => as(tokenA, () => jobs.create({ ...jobInput(), ...bad })), 404);
      }
      await denied(() => as(tokenA, () => jobs.create({ ...jobInput(), scheduledEnd: "2026-10-13T00:00:00Z" })), 400);
      const picker = await as(tokenA, () => jobs.staff(listParams));
      assert.equal(picker.staff.some((row) => row.id === foreign || row.id === inactive), false);
    });
    await t.test("lists, searches, filters, paginates and reassigns jobs", async () => {
      assert.equal((await as(staffToken, () => jobs.list({ ...listParams, mine: "true" }))).pagination.total, 2);
      const page = await as(tokenA, () => jobs.list({ ...listParams, pageSize: 1 }));
      assert.equal(page.jobs.length, 1); assert.equal(page.pagination.total, 2);
      assert.equal((await as(tokenA, () => jobs.list({ ...listParams, page: 999, pageSize: 1 }))).pagination.page, 2);
      assert.equal((await as(tokenA, () => jobs.list({ ...listParams, search: firstJob.referenceNumber }))).jobs[0].id, firstJob.id);
      assert.equal((await as(tokenA, () => jobs.list({ ...listParams, search: "Fixture repair" }))).pagination.total, 2);
      assert.equal((await as(tokenB, () => jobs.list({ ...listParams, search: "Fixture repair" }))).pagination.total, 0);
      assert.equal((await as(tokenA, () => jobs.list({ ...listParams, serviceRequestId: otherRequest.id }))).pagination.total, 0);
      const scheduledStart = new Date(Date.now() + 86_400_000).toISOString();
      const scheduledEnd = new Date(Date.now() + 93_600_000).toISOString();
      await as(tokenA, () => jobs.update(firstJob.id, { assignedStaffId: admin, description: "Updated repair", location: "Cebu", internalNotes: "Updated notes", scheduledStart, scheduledEnd }));
      assert.equal((await as(tokenA, () => jobs.get(firstJob.id))).assignedStaffId, admin);
      assert.equal((await as(staffToken, () => jobs.list({ ...listParams, mine: "true" }))).pagination.total, 1);
      await denied(() => as(tokenA, () => api.put(`/jobs/${firstJob.id}`, { scheduledStart: new Date(Date.parse(scheduledEnd) + 60_000).toISOString() })), 400);
      for (const field of ["scheduledStart", "scheduledEnd"]) {
        const past = new Date(Date.now() - 60_000).toISOString();
        await denied(() => as(tokenA, () => api.put(`/jobs/${firstJob.id}`, { [field]: past })), 400);
        await denied(() => as(tokenA, () => jobs.create({ ...jobInput(), [field]: past })), 400);
      }
    });
    await t.test("enforces permissions and tenant isolation on every job operation", async () => {
      for (const work of [() => jobs.get(firstJob.id), () => jobs.update(firstJob.id, { ...jobInput(), assignedStaffId: foreign }),
        () => jobs.status(firstJob.id, "IN_PROGRESS"), () => jobs.cancel(firstJob.id, "Foreign cancellation")]) await denied(() => as(tokenB, work), 404);
      assert.equal((await as(tokenB, () => jobs.list(listParams))).pagination.total, 0);
      for (const work of [() => jobs.create(jobInput()), () => jobs.update(firstJob.id, jobInput()), () => jobs.status(firstJob.id, "IN_PROGRESS"),
        () => jobs.cancel(firstJob.id, "Denied"), () => jobs.staff(listParams)]) await denied(() => as(readerToken, work), 403);
      assert.equal((await fetch(`${process.env.NEXT_PUBLIC_API_URL}/jobs`)).status, 401);
    });
    await t.test("starts the parent request, records history and keeps completion explicit", async () => {
      await denied(() => as(tokenA, () => jobs.status(firstJob.id, "COMPLETED")), 409);
      await as(staffToken, () => jobs.status(firstJob.id, "IN_PROGRESS", "Work started"));
      assert.equal((await as(tokenA, () => requests.get(firstRequest.id))).status, "IN_PROGRESS");
      await as(staffToken, () => jobs.status(firstJob.id, "COMPLETED", "Work finished"));
      assert.equal((await as(tokenA, () => requests.get(firstRequest.id))).status, "IN_PROGRESS");
      await denied(() => as(tokenA, () => requests.status(firstRequest.id, "COMPLETED")), 409);
      await denied(() => as(tokenA, () => invoices.create(invoiceInput(firstJob.id))), 409);
      await as(tokenA, () => jobs.status(secondJob.id, "IN_PROGRESS")); await as(tokenA, () => jobs.status(secondJob.id, "COMPLETED"));
      assert.equal((await as(tokenA, () => jobs.list({ ...listParams, search: "Fixture repair", billable: "true" }))).pagination.total, 0);
      await as(tokenA, () => requests.status(firstRequest.id, "COMPLETED"));
      const billable = await as(tokenA, () => jobs.list({ ...listParams, search: "Fixture repair", billable: "true" }));
      assert.deepEqual(new Set(billable.jobs.map((job) => job.id)), new Set([firstJob.id, secondJob.id]));
      assert.equal((await as(tokenB, () => jobs.list({ ...listParams, search: "Fixture repair", billable: "true" }))).pagination.total, 0);
      const detail = await as(tokenA, () => jobs.get(firstJob.id));
      assert.equal(detail.statusHistory.length, 3); assert.ok(detail.startedAt); assert.ok(detail.completedAt);
      await denied(() => as(tokenA, () => jobs.update(firstJob.id, jobInput())), 409);
      await denied(() => as(tokenA, () => jobs.create(jobInput())), 409);
      await denied(() => as(tokenA, () => jobs.status(firstJob.id, "IN_PROGRESS")), 409);
      thirdJob = await as(tokenA, () => jobs.create(jobInput(otherRequest.id)));
      await denied(() => as(tokenA, () => invoices.create(invoiceInput(thirdJob.id))), 409);
    });
    await t.test("calculates invoice totals on the server and scopes every billing operation", async () => {
      const input = { ...invoiceInput(firstJob.id), items: [{ description: "Repair", quantity: "1", unitPrice: "100.00" }, { description: "Half cent", quantity: "0.50", unitPrice: "0.01" }] };
      const created = await as(tokenA, () => api.post("/invoices", { ...input, total: "9999.99", amountPaid: "9999.99", customerId: customerB, organizationId: orgB }));
      invoiceA = created.data.data;
      assert.equal(invoiceA.total, "100.01"); assert.equal(invoiceA.balance, "100.01"); assert.equal(invoiceA.amountPaid, "0");
      assert.equal(invoiceA.customerId, customerA);
      invoiceB = await as(tokenA, () => invoices.create(invoiceInput(secondJob.id, "50.00")));
      await denied(() => as(tokenA, () => invoices.create(input)), 409);
      await as(tokenA, () => invoices.update(invoiceA.id, { items: input.items, dueAt: null, notes: "Updated invoice" }));
      assert.equal((await as(tokenA, () => invoices.get(invoiceA.id))).items.length, 2);
      assert.equal((await as(tokenA, () => invoices.list({ ...listParams, pageSize: 1 }))).pagination.total, 2);
      assert.equal((await as(tokenA, () => invoices.list({ ...listParams, serviceRequestId: firstRequest.id }))).pagination.total, 2);
      assert.equal((await as(tokenA, () => invoices.list({ ...listParams, search: invoiceA.invoiceNumber }))).invoices[0].id, invoiceA.id);
      assert.equal((await as(tokenB, () => invoices.list(listParams))).pagination.total, 0);
      for (const work of [() => invoices.get(invoiceA.id), () => invoices.create(invoiceInput(firstJob.id)), () => invoices.update(invoiceA.id, input),
        () => invoices.void(invoiceA.id, "Foreign void"), () => invoices.pay(invoiceA.id, payment("1"))]) await denied(() => as(tokenB, work), 404);
      for (const work of [() => invoices.create(input), () => invoices.update(invoiceA.id, input), () => invoices.void(invoiceA.id, "Denied"),
        () => invoices.pay(invoiceA.id, payment("1"))]) await denied(() => as(readerToken, work), 403);
      assert.equal((await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invoices`)).status, 401);
    });
    await t.test("records partial/full payments, rejects overpayment and replays stable retry keys", async () => {
      await denied(() => as(tokenA, () => invoices.pay(invoiceA.id, payment("100.02"))), 409);
      await denied(() => as(tokenA, () => invoices.pay(invoiceA.id, payment("-1"))), 400);
      const firstPayment = payment("30.00", { method: "BANK_TRANSFER", referenceNumber: `bank-${tag}` });
      const partial = await as(tokenA, () => invoices.pay(invoiceA.id, firstPayment));
      assert.equal(partial.invoice.status, "PARTIALLY_PAID"); assert.equal(partial.invoice.balance, "70.01");
      assert.equal((await as(tokenA, () => invoices.pay(invoiceA.id, firstPayment))).replayed, true);
      await denied(() => as(tokenA, () => invoices.pay(invoiceA.id, { ...firstPayment, amount: "31" })), 409);
      await denied(() => as(tokenA, () => invoices.pay(invoiceA.id, { ...firstPayment, idempotencyKey: randomUUID() })), 409);
      assert.equal(await prisma.payment.count({ where: { invoiceId: invoiceA.id } }), 1);
      await denied(() => as(tokenA, () => invoices.update(invoiceA.id, invoiceInput(firstJob.id))), 409);
      await denied(() => as(tokenA, () => invoices.void(invoiceA.id, "Already paid")), 409);
      const settled = await as(tokenA, () => invoices.pay(invoiceA.id, payment("70.01")));
      assert.equal(settled.invoice.status, "PAID"); assert.equal(settled.invoice.balance, "0.00");
      assert.equal((await as(tokenA, () => invoices.pay(invoiceA.id, firstPayment))).invoice.status, "PAID");
      await denied(() => as(tokenA, () => invoices.pay(invoiceA.id, payment("1"))), 409);
      assert.equal((await as(tokenA, () => invoices.get(invoiceA.id))).payments.length, 2);
      assert.equal(await prisma.auditLog.count({ where: { entityId: invoiceA.id, action: "payment.invoice.success", organizationId: orgA } }), 2);
    });
    await t.test("serializes concurrent payments and concurrent identical retries", async () => {
      setAccessToken(tokenA);
      const results = await Promise.allSettled([safe(() => invoices.pay(invoiceB.id, payment("30"))), safe(() => invoices.pay(invoiceB.id, payment("30")))]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.find((result) => result.status === "rejected").reason.status, 409);
      const last = payment("20");
      const retries = await Promise.all([safe(() => invoices.pay(invoiceB.id, last)), safe(() => invoices.pay(invoiceB.id, last))]);
      assert.equal(retries.every((result) => result.invoice.status === "PAID"), true);
      assert.equal(await prisma.payment.count({ where: { invoiceId: invoiceB.id } }), 2);
      assert.equal((await as(tokenA, () => invoices.get(invoiceB.id))).amountPaid, "50");
    });
    await t.test("rolls back job and financial changes when auditing fails; voids only unpaid invoices", async () => {
      await as(tokenA, () => jobs.status(thirdJob.id, "IN_PROGRESS")); await as(tokenA, () => jobs.status(thirdJob.id, "COMPLETED"));
      await as(tokenA, () => requests.status(otherRequest.id, "COMPLETED"));
      invoiceC = await as(tokenA, () => invoices.create(invoiceInput(thirdJob.id, "10")));
      const open = await as(tokenA, () => requests.create(requestInput("Audit rollback request")));
      const count = await prisma.job.count({ where: { organizationId: orgA } });
      auditService.recordInTransaction = async () => { throw new Error("Injected audit failure"); };
      try {
        await denied(() => as(tokenA, () => jobs.create(jobInput(open.id))), 500);
        await denied(() => as(tokenA, () => invoices.pay(invoiceC.id, payment("5"))), 500);
        await denied(() => as(tokenA, () => invoices.update(invoiceC.id, { ...invoiceInput(thirdJob.id, "99"), notes: "Failed edit" })), 500);
        assert.equal(await prisma.job.count({ where: { organizationId: orgA } }), count);
        assert.equal(await prisma.payment.count({ where: { invoiceId: invoiceC.id } }), 0);
        assert.equal((await prisma.invoice.findUnique({ where: { id: invoiceC.id } })).total.toFixed(2), "10.00");
      } finally { auditService.recordInTransaction = originalAudit; }
      await as(tokenA, () => invoices.void(invoiceC.id, "Fixture void"));
      await denied(() => as(tokenA, () => invoices.pay(invoiceC.id, payment("1"))), 409);
      await denied(() => as(tokenA, () => invoices.update(invoiceC.id, invoiceInput(thirdJob.id))), 409);
      const cancellation = await as(tokenA, () => jobs.create(jobInput(open.id)));
      await denied(() => as(tokenA, () => jobs.cancel(cancellation.id, "")), 400);
      await as(tokenA, () => jobs.cancel(cancellation.id, "Cancelled before work"));
      await denied(() => as(tokenA, () => jobs.status(cancellation.id, "IN_PROGRESS")), 409);
      await as(tokenA, () => requests.status(open.id, "CANCELLED"));
    });
    await t.test("honors inactive grants and user-specific denials", async () => {
      await prisma.rolePermission.updateMany({ where: { roleId: staffRole, permissionId: permissionIds[P.JOB_UPDATE] }, data: { isActive: false } });
      await denied(() => as(staffToken, () => jobs.status(firstJob.id, "IN_PROGRESS")), 403);
      await prisma.userPermission.createMany({ data: [P.JOB_READ, P.INVOICE_READ].map((name) => ({ userId: reader, permissionId: permissionIds[name], isActive: false })) });
      await denied(() => as(readerToken, () => jobs.list(listParams)), 403); await denied(() => as(readerToken, () => jobs.get(firstJob.id)), 403);
      await denied(() => as(readerToken, () => invoices.list(listParams)), 403); await denied(() => as(readerToken, () => invoices.get(invoiceA.id)), 403);
    });
    if (process.env.RUN_BROWSER_WORKFLOW_TESTS === "1") await t.test("actual browser finishes a request and recovers a lost payment response", async () => {
      const request = await as(tokenA, () => requests.create(requestInput("Browser workflow repair")));
      browserMode = true;
      const { runWorkflowBrowser } = await import("./browser-flow.mjs");
      await runWorkflowBrowser({ app, slug: orgA, requestId: request.id, staffId: admin, prisma, organizationId: orgA, dropNextPayment: () => { dropPaymentResponse = true; } });
      browserMode = false;
    });
  } finally {
    auditService.recordInTransaction = originalAudit;
    if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    try {
      await prisma.$transaction(async (db) => {
        await db.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
        await db.payment.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await db.invoiceItem.deleteMany({ where: { invoice: { organizationId: { in: orgIds } } } });
        await db.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await db.jobStatusHistory.deleteMany({ where: { job: { organizationId: { in: orgIds } } } });
        await db.job.deleteMany({ where: { organizationId: { in: orgIds } } });
        await db.serviceRequest.deleteMany({ where: { organizationId: { in: orgIds } } });
        await db.serviceType.deleteMany({ where: { organizationId: { in: orgIds } } });
        await db.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
        await db.userPermission.deleteMany({ where: { userId: { in: userIds } } });
        await db.user.deleteMany({ where: { id: { in: userIds }, organizationId: { in: orgIds } } });
        await db.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
        await db.role.deleteMany({ where: { id: { in: roleIds }, organizationId: { in: orgIds } } });
        if (createdPermissions.length) await db.permission.deleteMany({ where: { id: { in: createdPermissions } } });
        await db.organization.deleteMany({ where: { id: { in: orgIds } } });
      }, { timeout: 15000 });
      if (testIps.size) await redis.del(...[...testIps].map((ip) => `rl:write:${ip}`));
    } finally { await prisma.$disconnect(); redis.disconnect(); }
  }
});
