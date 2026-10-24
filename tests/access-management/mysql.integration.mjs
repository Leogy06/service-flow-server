// Opt-in integration: real frontend Axios functions, HTTP routes, JWTs, MySQL and Redis.
// Creates UUID-scoped fixtures and removes only those fixtures; never resets the database.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import process from "node:process";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

if (process.env.RUN_DB_ACCESS_TESTS !== "1" || process.env.NODE_ENV !== "test") {
  throw new Error("Run the opt-in npm run test:access:mysql command.");
}
const { registerHooks } = await import("node:module");
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "@/lib/email/send-login-code" || specifier === "@/lib/email/send-login-code.js") {
    return { url: "data:text/javascript,export async function sendLoginCodeEmail(_to,_name,code){globalThis.__serviceFlowAccessTestCode=code;}", shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis, redisReady } = await import("../../src/lib/redis.ts");
const { PERMISSIONS } = await import("../../src/constants/permission.constants.ts");
const { authenticate } = await import("../../src/middleware/auth.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { requirePermission } = await import("../../src/middleware/require-permission.ts");
const { errorHandler } = await import("../../src/middleware/errorHandler.ts");
const { default: userPermissionRoutes } = await import("../../src/modules/user-permission/user.permission.routes.ts");
const { default: userRoutes } = await import("../../src/modules/user/user.routes.ts");
const { default: permissionRoutes } = await import("../../src/modules/permission/permission.route.ts");
const { default: roleRoutes } = await import("../../src/modules/role/role.routes.ts");
const { default: authRoutes } = await import("../../src/modules/auth/auth.routes.ts");
const { default: organizationRoutes } = await import("../../src/modules/organization/organization.route.ts");
const { authService } = await import("../../src/modules/auth/auth.service.ts");
const { twoFactorService } = await import("../../src/modules/auth/two-factor.service.ts");
const { auditService } = await import("../../src/modules/audit/audit.service.ts");
const { generateAccessToken, verifyAccessToken } = await import("../../src/utils/tokens.ts");
const { default: bcrypt } = await import("bcryptjs");

test("frontend role and staff permission APIs through HTTP and MySQL", { timeout: process.env.RUN_BROWSER_ACCESS_TESTS === "1" ? 300000 : 90000 }, async (t) => {
  const tag = randomUUID();
  const orgA = `access-it-a-${tag}`, orgB = `access-it-b-${tag}`;
  const adminId = `access-it-admin-${tag}`, staffId = `access-it-staff-${tag}`, foreignId = `access-it-foreign-${tag}`;
  const adminRole = `access-it-admin-role-${tag}`, staffRole = `access-it-staff-role-${tag}`, emptyRole = `access-it-empty-role-${tag}`, foreignRole = `access-it-foreign-role-${tag}`;
  const orgIds = [orgA, orgB], userIds = [adminId, staffId, foreignId], roleIds = [adminRole, staffRole, emptyRole, foreignRole];
  const createdPermissionIds = [];
  const ids = {};
  const password = randomUUID();
  const testIp = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
  const testIps = new Set([testIp]);
  const server = createServer();
  const originalAudit = auditService.recordInTransaction;
  try {
    await redisReady();
    await redis.ping();
    for (const name of [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.CUSTOMER_UPDATE, PERMISSIONS.USER_READ, PERMISSIONS.USER_UPDATE,
      PERMISSIONS.ROLE_READ, PERMISSIONS.ROLE_CREATE, PERMISSIONS.ROLE_UPDATE, PERMISSIONS.ROLE_DELETE]) {
      let permission = await prisma.permission.findUnique({ where: { name } });
      if (permission && permission.organizationId !== null) throw new Error("Integration requires global definitions for the tested permissions.");
      if (!permission) {
        permission = await prisma.permission.create({ data: { id: `access-it-permission-${randomUUID()}`, name, description: "Temporary access integration definition" } });
        createdPermissionIds.push(permission.id);
      }
      ids[name] = permission.id;
    }
    await prisma.organization.createMany({ data: [
      { id: orgA, name: "Temporary access test A", slug: orgA }, { id: orgB, name: "Temporary access test B", slug: orgB },
    ] });
    await prisma.role.createMany({ data: [
      { id: adminRole, name: "Admin", organizationId: orgA }, { id: staffRole, name: "Staff", organizationId: orgA },
      { id: emptyRole, name: "Empty", organizationId: orgA }, { id: foreignRole, name: "Staff", organizationId: orgB },
    ] });
    await prisma.rolePermission.createMany({ data: [
      ...Object.values(ids).map((permissionId) => ({ roleId: adminRole, permissionId, isActive: true })),
      { roleId: staffRole, permissionId: ids[PERMISSIONS.CUSTOMER_READ], isActive: true },
      { roleId: foreignRole, permissionId: ids[PERMISSIONS.CUSTOMER_READ], isActive: true },
    ] });
    await prisma.user.createMany({ data: [
      { id: adminId, firstName: "Admin", lastName: "Fixture", email: `${adminId}@example.invalid`, password: await bcrypt.hash(password, 4), roleId: adminRole, organizationId: orgA, status: "ACTIVE" },
      { id: staffId, firstName: "Staff", lastName: "Fixture", email: `${staffId}@example.invalid`, password: await bcrypt.hash(password, 4), roleId: staffRole, organizationId: orgA, status: "ACTIVE" },
      { id: foreignId, firstName: "Foreign", lastName: "Fixture", email: `${foreignId}@example.invalid`, roleId: foreignRole, organizationId: orgB, status: "ACTIVE" },
    ] });
    const app = express();
    app.use((req, _res, next) => {
      // Independent test clients exercise sensitive operations without weakening real rate limits.
      let clientIp = testIp;
      if (req.method !== "GET") {
        do { clientIp = `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`; } while (testIps.has(clientIp));
        testIps.add(clientIp);
      }
      req.headers["x-forwarded-for"] = clientIp;
      next();
    });
    app.use(cors({ origin: /^http:\/\/localhost:\d+$/, credentials: true }));
    // Trust only the local test listener's synthetic client identity for isolated rate-limit keys.
    app.set("trust proxy", "loopback");
    app.use(express.json(), cookieParser(), withRequestContext);
    app.use("/api/user-permission", userPermissionRoutes);
    app.use("/api/users", authenticate, userRoutes);
    app.use("/api/permission", permissionRoutes);
    app.use("/api/role", authenticate, roleRoutes);
    app.use("/api/auth", authRoutes);
    app.use("/api/organization", organizationRoutes);
    app.get("/api/probe", authenticate, requirePermission(PERMISSIONS.CUSTOMER_READ), (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);
    server.on("request", app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    process.env.NEXT_PUBLIC_API_URL = `http://localhost:${address.port}/api`;
    const { api, setAccessToken } = await import("../../../frontend/app/lib/api/client.ts");
    const { userAccessApi } = await import("../../../frontend/features/users/api/user-access-api.ts");
    const { roleApi } = await import("../../../frontend/features/role/api/roleApi.ts");
    api.defaults.headers.common["X-Forwarded-For"] = testIp;
    const tokenFor = (id, role, organizationId) => generateAccessToken({ id, role, organizationId, firstName: "Test", lastName: "Fixture", email: `${id}@example.invalid`, permissions: Object.values(PERMISSIONS) });
    const adminToken = tokenFor(adminId, "Admin", orgA), staffToken = tokenFor(staffId, "Staff", orgA);
    async function as(token, action) {
      setAccessToken(token);
      try { return await action(); }
      catch (error) {
        // Never print Axios request configs, credentials or tokens when assertions fail.
        const safe = new Error(`HTTP request failed with status ${error.response?.status ?? "unknown"}`);
        safe.status = error.response?.status;
        throw safe;
      }
    }
    const save = (overrides, id = staffId, token = adminToken) => as(token, () => userAccessApi.savePermissions({ userId: id, overrides }));
    const readId = ids[PERMISSIONS.CUSTOMER_READ], updateId = ids[PERMISSIONS.CUSTOMER_UPDATE];
    const defaultsBefore = await prisma.rolePermission.findMany({ where: { roleId: staffRole }, orderBy: { permissionId: "asc" } });
    const listParams = { page: 1, pageSize: 10, search: "", sortBy: "name", sortOrder: "asc", deleted: false };
    let lifecycleRole;
    const lifecycleName = `Lifecycle ${tag}`;
    const lifecyclePermissions = [readId, updateId];
    await t.test("creates a real role, paginates and sorts tenant-scoped search results", async () => {
      lifecycleRole = await as(adminToken, () => roleApi.save({ input: { name: lifecycleName, permissionIds: lifecyclePermissions } }));
      roleIds.push(lifecycleRole.id);
      const page = await as(adminToken, () => roleApi.list({ ...listParams, pageSize: 2 }));
      assert.equal(page.pagination.total, 4);
      assert.equal(page.pagination.totalPages, 2);
      assert.deepEqual(page.roles.map((r) => r.name), ["Admin", "Empty"]);
      const descending = await as(adminToken, () => roleApi.list({ ...listParams, page: 2, pageSize: 2, sortOrder: "desc" }));
      assert.deepEqual(descending.roles.map((r) => r.name), ["Empty", "Admin"]);
      const search = await as(adminToken, () => roleApi.list({ ...listParams, search: "Staff" }));
      assert.deepEqual(search.roles.map((r) => r.id), [staffRole]);
      assert.equal(search.pagination.total, 1);
      const empty = await as(adminToken, () => roleApi.list({ ...listParams, search: "not present" }));
      assert.equal(empty.pagination.total, 0);
      assert.deepEqual(empty.roles, []);
    });
    await t.test("renames without touching role default rows, user assignments or overrides", async () => {
      const defaults = await prisma.rolePermission.findMany({ where: { roleId: lifecycleRole.id }, orderBy: { permissionId: "asc" } });
      await as(adminToken, () => roleApi.save({ id: lifecycleRole.id, input: { name: `${lifecycleName} renamed` } }));
      assert.deepEqual(await prisma.rolePermission.findMany({ where: { roleId: lifecycleRole.id }, orderBy: { permissionId: "asc" } }), defaults);
      assert.equal((await prisma.user.findUnique({ where: { id: staffId } })).roleId, staffRole);
      assert.deepEqual(await prisma.userPermission.findMany({ where: { userId: staffId } }), []);
      await assert.rejects(() => as(adminToken, () => roleApi.save({ id: lifecycleRole.id, input: { name: "staff" } })), (error) => error.status === 409);
    });
    await t.test("archives and restores real defaults, audits and assignment choices", async () => {
      const before = await prisma.rolePermission.findMany({ where: { roleId: lifecycleRole.id }, orderBy: { permissionId: "asc" } });
      await as(adminToken, () => roleApi.delete(lifecycleRole.id));
      assert.ok((await prisma.role.findUnique({ where: { id: lifecycleRole.id } })).deletedAt);
      assert.deepEqual(await prisma.rolePermission.findMany({ where: { roleId: lifecycleRole.id }, orderBy: { permissionId: "asc" } }), before);
      assert.equal((await as(adminToken, () => roleApi.assignable())).some((r) => r.id === lifecycleRole.id), false);
      const archives = await as(adminToken, () => roleApi.list({ ...listParams, deleted: true }));
      assert.deepEqual(archives.roles.map((r) => r.id), [lifecycleRole.id]);
      await assert.rejects(() => as(adminToken, () => userAccessApi.assignRole({ userId: staffId, roleId: lifecycleRole.id })), (error) => error.status === 404);
      await assert.rejects(() => as(adminToken, () => roleApi.restore({ id: lifecycleRole.id, name: "Staff" })), (error) => error.status === 409);
      await as(adminToken, () => roleApi.restore({ id: lifecycleRole.id }));
      assert.equal((await prisma.role.findUnique({ where: { id: lifecycleRole.id } })).deletedAt, null);
      assert.deepEqual(await prisma.rolePermission.findMany({ where: { roleId: lifecycleRole.id }, orderBy: { permissionId: "asc" } }), before);
      const audits = await prisma.auditLog.findMany({ where: { entityId: lifecycleRole.id, action: { in: ["delete.role.success", "restore.role.success"] } } });
      assert.equal(audits.length, 2);
      assert.ok(audits.every((row) => row.actorId === adminId && row.organizationId === orgA));
    });
    await t.test("enforces role archive and restoration authorization against MySQL", async () => {
      await assert.rejects(() => as(adminToken, () => roleApi.delete(staffRole)), (error) => error.status === 409);
      await assert.rejects(() => as(adminToken, () => roleApi.delete(adminRole)), (error) => error.status === 403);
      await assert.rejects(() => as(adminToken, () => roleApi.delete(foreignRole)), (error) => error.status === 404);
      await assert.rejects(() => as(adminToken, () => roleApi.restore({ id: foreignRole })), (error) => error.status === 404);
      await assert.rejects(() => as(staffToken, () => roleApi.restore({ id: lifecycleRole.id })), (error) => error.status === 403);
      await as(adminToken, () => roleApi.delete(lifecycleRole.id));
      await assert.rejects(() => as(adminToken, () => roleApi.save({ input: { name: `${lifecycleName} renamed` } })), (error) => error.status === 409);
      auditService.recordInTransaction = (db) => db.auditLog.create({ data: { actorId: `missing-${tag}`, action: "test.audit.failure", entity: "Role", entityId: lifecycleRole.id, organizationId: orgA } });
      try { await assert.rejects(() => as(adminToken, () => roleApi.restore({ id: lifecycleRole.id })), (error) => error.status === 409); }
      finally { auditService.recordInTransaction = originalAudit; }
      assert.ok((await prisma.role.findUnique({ where: { id: lifecycleRole.id } })).deletedAt);
      await as(adminToken, () => roleApi.restore({ id: lifecycleRole.id }));
    });

    await t.test("loads actual staff details, role defaults and the authorized catalog", async () => {
      const detail = await as(adminToken, () => userAccessApi.get(staffId));
      assert.equal(detail.email, `${staffId}@example.invalid`);
      assert.equal(detail.status, "ACTIVE");
      assert.equal(detail.role.id, staffRole);
      assert.deepEqual(detail.overrides, []);
      assert.deepEqual(detail.effectivePermissions, [PERMISSIONS.CUSTOMER_READ]);
      const catalog = await as(adminToken, () => api.get("/permission"));
      assert.deepEqual(catalog.data.data.map((p) => p.name).sort(), [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.CUSTOMER_UPDATE].sort());
    });
    await t.test("persists a batch grant and inherited denial without changing the role", async () => {
      await save([{ permissionId: readId, state: "deny" }, { permissionId: updateId, state: "grant" }]);
      const rows = await prisma.userPermission.findMany({ where: { userId: staffId } });
      assert.equal(rows.find((row) => row.permissionId === readId).isActive, false);
      assert.equal(rows.find((row) => row.permissionId === updateId).isActive, true);
      assert.equal((await prisma.user.findUnique({ where: { id: staffId } })).roleId, staffRole);
      assert.deepEqual(await prisma.rolePermission.findMany({ where: { roleId: staffRole }, orderBy: { permissionId: "asc" } }), defaultsBefore);
    });
    await t.test("reloads persisted overrides and enforces deny with a previously issued JWT", async () => {
      const detail = await as(adminToken, () => userAccessApi.get(staffId));
      assert.equal(detail.overrides.find((row) => row.permissionId === readId).isActive, false);
      const me = await as(staffToken, () => api.get("/auth/me"));
      assert.deepEqual(me.data.data.permissions, [PERMISSIONS.CUSTOMER_UPDATE]);
      await assert.rejects(() => as(staffToken, () => api.get("/probe")), (error) => error.status === 403);
    });
    await t.test("restores inherit by deleting only that override", async () => {
      await save([{ permissionId: readId, state: "inherit" }]);
      assert.equal(await prisma.userPermission.count({ where: { userId: staffId, permissionId: readId } }), 0);
      assert.equal(await prisma.userPermission.count({ where: { userId: staffId, permissionId: updateId, isActive: true } }), 1);
      assert.equal((await as(staffToken, () => api.get("/probe"))).status, 200);
    });
    await t.test("scopes grant, deny and inherit to the tenant and authorized permissions", async () => {
      for (const state of ["grant", "deny", "inherit"]) {
        await assert.rejects(() => save([{ permissionId: readId, state }], foreignId), (error) => error.status === 404);
        await assert.rejects(() => save([{ permissionId: ids[PERMISSIONS.USER_UPDATE], state }]), (error) => error.status === 403);
        await assert.rejects(() => save([{ permissionId: readId, state }], adminId), (error) => error.status === 403);
        await assert.rejects(() => save([{ permissionId: readId, state }], staffId, staffToken), (error) => error.status === 403);
      }
    });
    await t.test("records actor, tenant and override states in committed AuditLog rows", async () => {
      const audits = await prisma.auditLog.findMany({ where: { entityId: staffId, action: "update.user.permissions.success" }, orderBy: { createdAt: "asc" } });
      assert.equal(audits.length, 2);
      assert.equal(audits[0].actorId, adminId);
      assert.equal(audits[0].organizationId, orgA);
      assert.ok(audits[0].requestId);
      assert.ok(audits[0].metadata.after.some((row) => row.permissionId === readId && row.isActive === false));
    });
    await t.test("rolls back MySQL overrides when the transactional audit insert fails", async () => {
      const before = await prisma.userPermission.findMany({ where: { userId: staffId } });
      auditService.recordInTransaction = (db) => db.auditLog.create({ data: { actorId: `missing-${tag}`, action: "test.audit.failure", entity: "User", entityId: staffId, organizationId: orgA } });
      try { await assert.rejects(() => save([{ permissionId: readId, state: "deny" }]), (error) => error.status === 409); }
      finally { auditService.recordInTransaction = originalAudit; }
      assert.deepEqual(await prisma.userPermission.findMany({ where: { userId: staffId } }), before);
    });
    await t.test("login and refresh JWTs use denial-aware resolution", async () => {
      await save([{ permissionId: readId, state: "deny" }]);
      const hints = { userAgent: "Synthetic access integration", ipAddress: "127.0.0.1", trustedTokens: {} };
      const challenge = await authService.login(`${staffId}@example.invalid`, password, hints);
      assert.equal(challenge.requiresTwoFactor, true);
      assert.equal(challenge.accessToken, undefined, "Password alone must not create a session");
      const code = globalThis.__serviceFlowAccessTestCode;
      delete globalThis.__serviceFlowAccessTestCode;
      assert.match(code, /^\d{4,8}$/);
      const loggedIn = await twoFactorService.verify(challenge.challengeId, code, false, hints);
      await assert.rejects(() => twoFactorService.verify(challenge.challengeId, code, false, hints), error => error.statusCode === 400);
      assert.deepEqual(verifyAccessToken(loggedIn.accessToken).permissions, [PERMISSIONS.CUSTOMER_UPDATE]);
      const refreshed = await authService.refresh(loggedIn.refreshToken);
      assert.deepEqual(verifyAccessToken(refreshed.accessToken).permissions, [PERMISSIONS.CUSTOMER_UPDATE]);
    });
    await t.test("role reassignment preserves explicit denials and grants", async () => {
      await as(adminToken, () => userAccessApi.assignRole({ userId: staffId, roleId: emptyRole }));
      const detail = await as(adminToken, () => userAccessApi.get(staffId));
      assert.deepEqual(detail.inheritedPermissions, []);
      assert.deepEqual(detail.effectivePermissions, [PERMISSIONS.CUSTOMER_UPDATE]);
      assert.equal(detail.overrides.find((row) => row.permissionId === readId).isActive, false);
    });
    await t.test("inherit on a role without a default remains denied", async () => {
      await save([{ permissionId: readId, state: "inherit" }]);
      const detail = await as(adminToken, () => userAccessApi.get(staffId));
      assert.equal(detail.effectivePermissions.includes(PERMISSIONS.CUSTOMER_READ), false);
      assert.equal(await prisma.userPermission.count({ where: { userId: staffId, permissionId: readId } }), 0);
    });
    if (process.env.RUN_BROWSER_ACCESS_TESTS === "1") await t.test("actual Roles table/lifecycle and staff overrides in the browser", async () => {
      const browserRoleIds = Array.from({ length: 12 }, () => `access-it-browser-role-${randomUUID()}`);
      roleIds.push(...browserRoleIds);
      await prisma.role.createMany({ data: browserRoleIds.map((id, index) => ({ id, name: `Browser pagination ${String(index + 1).padStart(2, "0")}`, organizationId: orgA })) });
      await as(adminToken, () => userAccessApi.assignRole({ userId: staffId, roleId: staffRole }));
      await save([{ permissionId: readId, state: "inherit" }, { permissionId: updateId, state: "inherit" }]);
      const { runBrowserFlow } = await import("./browser-flow.mjs");
      await runBrowserFlow({
        apiUrl: process.env.NEXT_PUBLIC_API_URL, slug: orgA,
        email: `${adminId}@example.invalid`, password, staffEmail: `${staffId}@example.invalid`,
        roleName: `Browser lifecycle ${tag}`,
        verifyRole: async (stage, name) => {
          const role = await prisma.role.findFirst({ where: { name, organizationId: orgA }, include: { permissions: true } });
          assert.ok(role, "Browser role was not persisted");
          if (!roleIds.includes(role.id)) roleIds.push(role.id);
          assert.equal(!!role.deletedAt, stage === "archived", `Unexpected archived state after ${stage}`);
          assert.deepEqual(role.permissions.map((grant) => grant.permissionId), [readId]);
          assert.equal(role.permissions[0].isActive, true);
          assert.deepEqual(await prisma.rolePermission.findMany({ where: { roleId: staffRole }, orderBy: { permissionId: "asc" } }), defaultsBefore);
          if (stage === "restored") {
            const audits = await prisma.auditLog.findMany({ where: { entityId: role.id } });
            for (const action of ["create.role.success", "update.role.success", "delete.role.success", "restore.role.success"]) {
              assert.ok(audits.some((row) => row.action === action && row.actorId === adminId && row.organizationId === orgA));
            }
          }
        },
        verify: async (stage) => {
          const rows = await prisma.userPermission.findMany({ where: { userId: staffId } });
          if (stage === "denied") {
            assert.equal(rows.find((row) => row.permissionId === readId)?.isActive, false);
            assert.equal(rows.find((row) => row.permissionId === updateId)?.isActive, true);
          } else assert.equal(rows.some((row) => row.permissionId === readId), false);
          assert.deepEqual(await prisma.rolePermission.findMany({ where: { roleId: staffRole }, orderBy: { permissionId: "asc" } }), defaultsBefore);
        },
      });
    });
  } finally {
    auditService.recordInTransaction = originalAudit;
    if (server.listening) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    try {
      // Authentication evidence is immutable. Retain its referenced UUID
      // fixtures; the owned-container runner discards only this test database.
      const immutable = await prisma.auditLog.count({ where: { scope: "PLATFORM", OR: [{ organizationId: { in: orgIds } }, { actorId: { in: userIds } }] } });
      if (!immutable) await prisma.$transaction(async (db) => {
        // Include a browser-created role even if its response/verification failed.
        const fixtureRoles = await db.role.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
        const cleanupRoleIds = [...new Set([...roleIds, ...fixtureRoles.map((role) => role.id)])];
        await db.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
        await db.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { entityId: { in: [...userIds, ...roleIds] } }] } });
        await db.userPermission.deleteMany({ where: { userId: { in: userIds } } });
        await db.user.deleteMany({ where: { id: { in: userIds }, organizationId: { in: orgIds } } });
        await db.rolePermission.deleteMany({ where: { roleId: { in: cleanupRoleIds } } });
        await db.role.deleteMany({ where: { id: { in: cleanupRoleIds }, organizationId: { in: orgIds } } });
        if (createdPermissionIds.length) await db.permission.deleteMany({ where: { id: { in: createdPermissionIds } } });
        await db.organization.deleteMany({ where: { id: { in: orgIds } } });
      });
      await redis.del(...[...testIps].flatMap((ip) => ["write", "auth", "delete"].map((prefix) => `rl:${prefix}:${ip}`)));
    } finally { await prisma.$disconnect(); redis.disconnect(); }
  }
});
