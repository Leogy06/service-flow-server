// Opt-in real frontend Axios -> Express -> authorization -> MySQL integration.
// Fixtures use unique organization IDs; cleanup never touches existing tenant records.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import process from "node:process";
import express from "express";
import cors from "cors";
const { fetch } = globalThis;

if (process.env.RUN_DB_SERVICE_REQUEST_TESTS !== "1" || process.env.NODE_ENV !== "test") {
  throw new Error("Run npm run test:service-requests:mysql or test:service-requests:browser.");
}
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis, redisReady } = await import("../../src/lib/redis.ts");
const { authenticate } = await import("../../src/middleware/auth.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { errorHandler } = await import("../../src/middleware/errorHandler.ts");
const { default: routes } = await import("../../src/modules/service-request/service-request.routes.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const { auditService } = await import("../../src/modules/audit/audit.service.ts");
const { PERMISSIONS: P } = await import("../../src/constants/permission.constants.ts");

test("service request management through frontend APIs, HTTP and MySQL", { timeout: process.env.RUN_BROWSER_SERVICE_REQUEST_TESTS === "1" ? 300000 : 90000 }, async (t) => {
  const tag = randomUUID();
  const orgA = `sr-it-a-${tag}`, orgB = `sr-it-b-${tag}`;
  const orgIds = [orgA, orgB];
  const admin = `sr-admin-${tag}`, reader = `sr-reader-${tag}`, foreign = `sr-foreign-${tag}`;
  const adminRole = `sr-admin-role-${tag}`, readerRole = `sr-reader-role-${tag}`, foreignRole = `sr-foreign-role-${tag}`;
  const roleIds = [adminRole, readerRole, foreignRole];
  const userIds = [admin, reader, foreign];
  const customerA = `sr-customer-a-${tag}`, customerB = `sr-customer-b-${tag}`, deletedCustomer = `sr-deleted-${tag}`;
  const createdPermissions = [], permissionIds = {};
  const testIps = new Set();
  const originalAudit = auditService.recordInTransaction;
  const server = createServer();
  let browserMode = false, tokenA;
  try {
    await redisReady();
    await redis.ping();
    for (const name of [P.SERVICE_REQUEST_READ, P.SERVICE_REQUEST_CREATE, P.SERVICE_REQUEST_UPDATE, P.SERVICE_REQUEST_DELETE]) {
      let permission = await prisma.permission.findUnique({ where: { name } });
      if (permission?.organizationId) throw new Error("Tests require global service request permission definitions");
      if (!permission) {
        permission = await prisma.permission.create({ data: { name, description: "Service request integration fixture" } });
        createdPermissions.push(permission.id);
      }
      permissionIds[name] = permission.id;
    }
    await prisma.organization.createMany({ data: orgIds.map((id) => ({ id, name: "Service request integration fixture", slug: id })) });
    await prisma.role.createMany({ data: [
      { id: adminRole, name: "Admin", organizationId: orgA }, { id: readerRole, name: "Reader", organizationId: orgA },
      { id: foreignRole, name: "Admin", organizationId: orgB },
    ] });
    await prisma.rolePermission.createMany({ data: [
      ...[adminRole, foreignRole].flatMap((roleId) => Object.values(permissionIds).map((permissionId) => ({ roleId, permissionId }))),
      { roleId: readerRole, permissionId: permissionIds[P.SERVICE_REQUEST_READ] },
    ] });
    await prisma.user.createMany({ data: [
      { id: admin, roleId: adminRole, organizationId: orgA }, { id: reader, roleId: readerRole, organizationId: orgA },
      { id: foreign, roleId: foreignRole, organizationId: orgB },
    ].map((row) => ({ ...row, email: `${row.id}@example.invalid`, firstName: "Test", lastName: "Fixture", status: "ACTIVE" })) });
    await prisma.customer.createMany({ data: [
      { id: customerA, organizationId: orgA }, { id: customerB, organizationId: orgB }, { id: deletedCustomer, organizationId: orgA, deletedAt: new Date() },
    ].map((row, i) => ({ ...row, name: `${row.id}`, email: `${row.id}@example.invalid`, phoneNumber: `sr-${tag}-${i}` })) });
    const token = (id, organizationId) => generateAccessToken({ id, organizationId, role: "Admin", firstName: "Test", lastName: "Fixture", email: `${id}@example.invalid`, permissions: [] });
    tokenA = token(admin, orgA);
    const tokenB = token(foreign, orgB), readerToken = token(reader, orgA);
    const app = express();
    // Private test listener: browser session is tied to the fixture user, then authenticated normally.
    app.use((req, _res, next) => {
      let ip; do { ip = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`; } while (testIps.has(ip));
      testIps.add(ip); req.headers["x-forwarded-for"] = ip;
      if (browserMode) req.headers.authorization = `Bearer ${tokenA}`;
      next();
    });
    app.set("trust proxy", "loopback");
    app.use(cors({ origin: /^http:\/\/localhost:\d+$/, credentials: true }), express.json(), withRequestContext);
    app.get("/api/auth/me", authenticate, (req, res) => res.json({ data: req.user }));
    app.get("/api/organization/check-slug/:slug", (req, res) => {
      if (req.params.slug !== orgA) return res.status(404).json({ error: "Not found" });
      return res.json({ data: { id: orgA, slug: orgA, name: "Test organization" } });
    });
    app.use("/api/service-requests", authenticate, routes);
    app.use(errorHandler);
    server.on("request", app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${server.address().port}/api`;
    const { setAccessToken, api } = await import("../../../frontend/app/lib/api/client.ts");
    const { serviceRequestApi: client } = await import("../../../frontend/features/service-requests/api/service-request-api.ts");
    async function as(accessToken, work) {
      setAccessToken(accessToken);
      try { return await work(); }
      catch (error) { const safe = new Error(error.response?.data?.error ?? "HTTP request failed"); safe.status = error.response?.status; throw safe; }
    }
    const denied = async (work, status) => assert.rejects(work, (error) => error.status === status);
    const params = { page: 1, pageSize: 10, search: "", sortBy: "createdAt", sortOrder: "desc" };
    const typeParams = { page: 1, pageSize: 10, search: "", active: "all" };
    let typeA, typeB, first, second;
    await t.test("creates and edits service types within organization-scoped uniqueness", async () => {
      await as(tokenA, () => client.createType({ name: `Repair ${tag}`, description: "Repairs", basePrice: 100.25 }));
      await as(tokenB, () => client.createType({ name: `Repair ${tag}`, description: "Foreign", basePrice: 5 }));
      typeA = (await as(tokenA, () => client.types(typeParams))).serviceTypes[0];
      typeB = (await as(tokenB, () => client.types(typeParams))).serviceTypes[0];
      assert.notEqual(typeA.id, typeB.id);
      assert.equal(typeA.basePrice, "100.25");
      await denied(() => as(tokenA, () => client.createType({ name: `Repair ${tag}`, description: "", basePrice: 1 })), 409);
      await as(tokenA, () => client.updateType(typeA.id, { name: typeA.name, description: "Updated type", basePrice: 150 }));
      assert.equal((await as(tokenA, () => client.types(typeParams))).serviceTypes[0].description, "Updated type");
    });
    const input = () => ({ customerId: customerA, serviceTypeId: typeA.id, title: "Repair sink", description: "Leak under the sink", priority: "HIGH" });
    await t.test("creates requests with server references, trusted ownership and validation", async () => {
      first = await as(tokenA, () => client.create(input()));
      second = await as(tokenA, () => client.create({ ...input(), title: "Second request" }));
      assert.notEqual(first.referenceNumber, second.referenceNumber);
      assert.match(first.referenceNumber, /^SR-\d{8}-[A-F0-9-]+$/);
      assert.equal(first.status, "PENDING");
      assert.equal((await prisma.serviceRequest.findUnique({ where: { id: first.id } })).organizationId, orgA);
      for (const bad of [{ customerId: customerB }, { customerId: deletedCustomer }, { serviceTypeId: typeB.id }]) {
        await denied(() => as(tokenA, () => client.create({ ...input(), ...bad })), 404);
      }
      for (const bad of [{ title: " " }, { customerId: "" }, { priority: "BAD" }]) {
        await denied(() => as(tokenA, () => client.create({ ...input(), ...bad })), 400);
      }
      const injected = await as(tokenA, () => api.post("/service-requests", { ...input(), organizationId: orgB, status: "COMPLETED", referenceNumber: "client", trackingToken: "client" }));
      assert.equal(injected.data.data.status, "PENDING");
      assert.notEqual(injected.data.data.referenceNumber, "client");
      assert.equal("trackingToken" in injected.data.data, false);
      assert.equal((await prisma.serviceRequest.findUnique({ where: { id: injected.data.data.id } })).trackingToken, null);
    });
    await t.test("paginates, searches, filters and sorts the real frontend response contract", async () => {
      const list = await as(tokenA, () => client.list({ ...params, pageSize: 1 }));
      assert.equal(list.pagination.total, 3); assert.equal(list.requests.length, 1);
      assert.equal((await as(tokenA, () => client.list({ ...params, page: 999, pageSize: 1 }))).pagination.page, 3);
      assert.equal((await as(tokenA, () => client.list({ ...params, search: first.referenceNumber }))).requests[0].id, first.id);
      assert.equal((await as(tokenA, () => client.list({ ...params, search: customerA }))).pagination.total, 3);
      assert.equal((await as(tokenA, () => client.list({ ...params, status: "COMPLETED" }))).pagination.total, 0);
      assert.equal((await as(tokenA, () => client.list({ ...params, serviceTypeId: typeB.id }))).pagination.total, 0);
      const asc = (await as(tokenA, () => client.list({ ...params, sortOrder: "asc" }))).requests.map((row) => row.createdAt);
      assert.deepEqual(asc, [...asc].sort());
      const options = await as(tokenA, () => client.customers({ page: 1, pageSize: 10, search: "" }));
      assert.deepEqual(options.customers, [{ id: customerA, name: customerA }]);
      assert.deepEqual((await as(tokenB, () => client.list(params))).requests, []);
      await denied(() => as(tokenA, () => api.get("/service-requests", { params: { pageSize: 101 } })), 400);
    });
    await t.test("denies foreign nested resources and unauthorized operations", async () => {
      await denied(() => as(tokenB, () => client.get(first.id)), 404);
      await denied(() => as(tokenB, () => client.update(first.id, { title: "Foreign edit" })), 404);
      await denied(() => as(tokenB, () => client.status(first.id, "CANCELLED")), 404);
      await denied(() => as(tokenA, () => client.updateType(typeB.id, { name: "Hijack", description: "", basePrice: 0 })), 404);
      await denied(() => as(tokenA, () => client.archiveType(typeB.id)), 404);
      for (const work of [() => client.create(input()), () => client.update(first.id, { title: "Unauthorized" }),
        () => client.status(first.id, "IN_PROGRESS"), () => client.createType({ name: "Denied", description: "", basePrice: 0 }),
        () => client.updateType(typeA.id, { name: "Denied", description: "", basePrice: 0 }), () => client.archiveType(typeA.id),
        () => client.customers({ page: 1, pageSize: 10, search: "" })]) await denied(() => as(readerToken, work), 403);
      await prisma.userPermission.create({ data: { userId: reader, permissionId: permissionIds[P.SERVICE_REQUEST_READ], isActive: false } });
      await denied(() => as(readerToken, () => client.list(params)), 403);
      await denied(() => as(readerToken, () => client.get(first.id)), 403);
      await denied(() => as(readerToken, () => client.types(typeParams)), 403);
      const unauthenticated = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/service-requests`);
      assert.equal(unauthenticated.status, 401);
    });
    await t.test("enforces multi-job completion, terminal states and transactional activity history", async () => {
      await as(tokenA, () => client.update(first.id, { title: "Updated sink repair", description: "New description", priority: "URGENT" }));
      await denied(() => as(tokenA, () => client.status(first.id, "COMPLETED")), 409);
      await as(tokenA, () => client.status(first.id, "IN_PROGRESS"));
      await denied(() => as(tokenA, () => client.status(first.id, "COMPLETED")), 409);
      const jobs = [randomUUID(), randomUUID()];
      await prisma.job.createMany({ data: jobs.map((id, i) => ({ id, organizationId: orgA, customerId: customerA, serviceTypeId: typeA.id,
        serviceRequestId: first.id, referenceNumber: `JOB-${id}`, status: i ? "IN_PROGRESS" : "COMPLETED" })) });
      const detail = await as(tokenA, () => client.get(first.id));
      assert.equal(detail.jobs.length, 2); assert.equal(detail.title, "Updated sink repair");
      assert.equal(detail.activity.length, 3);
      await denied(() => as(tokenA, () => client.status(first.id, "COMPLETED")), 409);
      await denied(() => as(tokenA, () => client.status(first.id, "CANCELLED")), 409);
      await denied(() => as(tokenA, () => client.update(first.id, { customerId: customerB })), 409);
      await prisma.job.update({ where: { id: jobs[1] }, data: { status: "COMPLETED" } });
      await as(tokenA, () => client.status(first.id, "COMPLETED"));
      await denied(() => as(tokenA, () => client.status(first.id, "IN_PROGRESS")), 409);
      await denied(() => as(tokenA, () => client.update(first.id, { title: "Reopen" })), 409);
      const closed = await as(tokenA, () => client.get(first.id));
      assert.deepEqual(closed.allowedTransitions, []);
      assert.equal(closed.activity.filter((event) => event.action.startsWith("status_change.")).length, 2);
      const audit = await prisma.auditLog.findFirst({ where: { entityId: first.id, action: "status_change.service_request.success" } });
      assert.equal(audit.actorId, admin); assert.equal(audit.organizationId, orgA);
      await as(tokenA, () => client.status(second.id, "CANCELLED"));
      await denied(() => as(tokenA, () => client.status(second.id, "IN_PROGRESS")), 409);
    });
    await t.test("rolls back database writes when required audit recording fails", async () => {
      const count = await prisma.serviceRequest.count({ where: { organizationId: orgA } });
      auditService.recordInTransaction = async () => { throw new Error("Injected audit failure"); };
      try {
        await denied(() => as(tokenA, () => client.create(input())), 500);
        await denied(() => as(tokenA, () => client.updateType(typeA.id, { name: "Should roll back", description: "", basePrice: 1 })), 500);
        assert.equal(await prisma.serviceRequest.count({ where: { organizationId: orgA } }), count);
        assert.equal((await prisma.serviceType.findUnique({ where: { id: typeA.id } })).name, typeA.name);
      } finally { auditService.recordInTransaction = originalAudit; }
    });
    await t.test("archives types while retaining historical requests and blocking new selections", async () => {
      await as(tokenA, () => client.archiveType(typeA.id));
      assert.equal((await as(tokenA, () => client.types({ ...typeParams, active: "active" }))).pagination.total, 0);
      assert.equal((await as(tokenA, () => client.types({ ...typeParams, active: "archived" }))).pagination.total, 1);
      assert.equal((await as(tokenA, () => client.get(first.id))).serviceType.isActive, false);
      await denied(() => as(tokenA, () => client.create(input())), 404);
      assert.equal((await as(tokenB, () => client.types({ ...typeParams, active: "active" }))).pagination.total, 1);
    });
    if (process.env.RUN_BROWSER_SERVICE_REQUEST_TESTS === "1") await t.test("browser uses the real request APIs and database", async () => {
      browserMode = true;
      const { runServiceRequestBrowser } = await import("./browser-flow.mjs");
      await runServiceRequestBrowser({ app, slug: orgA, customerId: customerA, typeName: `Browser type ${tag}`, prisma, organizationId: orgA, admin, permissionId: permissionIds[P.SERVICE_REQUEST_UPDATE], auditService });
      browserMode = false;
    });
  } finally {
    auditService.recordInTransaction = originalAudit;
    if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    try {
      await prisma.$transaction(async (db) => {
        await db.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
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
      });
      if (testIps.size) await redis.del(...[...testIps].map((ip) => `rl:write:${ip}`));
    } finally { await prisma.$disconnect(); redis.disconnect(); }
  }
});
