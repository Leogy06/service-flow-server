import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import bcrypt from "bcryptjs";

const name = process.env.DATABASE_NAME ?? "";
if (process.env.NODE_ENV !== "test" || process.env.RUN_DB_PLATFORM_TESTS !== "1" ||
    !/^service_flow_platform_test_[a-z0-9_]+$/.test(name) || process.env.PLATFORM_TEST_DATABASE_NAME !== name ||
    new URL(process.env.DATABASE_URL).pathname !== `/${name}`) throw new Error("Isolated test database required");
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { authenticate } = await import("../../src/middleware/auth.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { default: userRoutes } = await import("../../src/modules/user/user.routes.ts");
const { authService } = await import("../../src/modules/auth/auth.service.ts");
const { auditService } = await import("../../src/modules/audit/audit.service.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");

test("tenant-admin password recovery uses real hashes, tenant isolation, immediate JWT/refresh revocation and atomic audit", { timeout: 90000 }, async () => {
  const tag = randomUUID();
  const adminPassword = `Admin-${tag}A1`, oldPassword = `Old-${tag}A1`, newPassword = `New-${tag}A1`;
  let server;
  const originalAudit = auditService.recordInTransaction;
  try {
    const orgA = await prisma.organization.create({ data: { name: "Password reset A", slug: `password-a-${tag}` } });
    const orgB = await prisma.organization.create({ data: { name: "Password reset B", slug: `password-b-${tag}` } });
    const adminRole = await prisma.role.create({ data: { name: "Tenant Admin", organizationId: orgA.id } });
    const staffRole = await prisma.role.create({ data: { name: "Staff", organizationId: orgA.id } });
    const foreignRole = await prisma.role.create({ data: { name: "Staff", organizationId: orgB.id } });
    for (const name of ["user:read", "user:update"]) {
      const permission = await prisma.permission.upsert({ where: { name }, create: { name }, update: {} });
      assert.equal(permission.organizationId, null);
      await prisma.rolePermission.create({ data: { roleId: adminRole.id, permissionId: permission.id, isActive: true } });
    }
    const admin = await prisma.user.create({ data: { email: `password-admin-${tag}@example.invalid`, firstName: "Admin", lastName: "Fixture", roleId: adminRole.id, organizationId: orgA.id, status: "ACTIVE", password: await bcrypt.hash(adminPassword, 4) } });
    const staff = await prisma.user.create({ data: { email: `password-staff-${tag}@example.invalid`, firstName: "Staff", lastName: "Fixture", roleId: staffRole.id, organizationId: orgA.id, status: "ACTIVE", password: await bcrypt.hash(oldPassword, 4) } });
    const foreign = await prisma.user.create({ data: { email: `password-foreign-${tag}@example.invalid`, firstName: "Foreign", lastName: "Fixture", roleId: foreignRole.id, organizationId: orgB.id, status: "ACTIVE", password: await bcrypt.hash(oldPassword, 4) } });
    const oldSignIn = await authService.login(staff.email, oldPassword);
    const adminToken = generateAccessToken({ ...admin, role: adminRole.name, permissions: [] });
    const app = express();
    let ip = 1;
    app.set("trust proxy", "loopback");
    app.use((req, _res, next) => { req.headers["x-forwarded-for"] = `10.249.1.${ip++}`; next(); });
    app.use(express.json(), withRequestContext);
    app.use("/users", authenticate, userRoutes);
    app.get("/self", authenticate, (_req, res) => res.json({ ok: true }));
    app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" }));
    server = createServer(app); await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${server.address().port}`;
    const body = { currentPassword: adminPassword, newPassword, confirmPassword: newPassword, reason: "Staff forgot their password", confirm: true };
    const reset = (id, body, token = adminToken) => fetch(`${base}/users/${id}/reset-password`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const self = (token) => fetch(`${base}/self`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await self(oldSignIn.accessToken)).status, 200);
    assert.equal((await reset(staff.id, body, null)).status, 401);
    assert.equal((await reset(foreign.id, body)).status, 404);
    assert.equal((await reset(admin.id, body)).status, 403);
    assert.equal((await reset(staff.id, { ...body, currentPassword: "Incorrect123!" })).status, 400);
    const response = await reset(staff.id, body);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.sessionsRevoked, 1);
    const current = await prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
    assert.equal(await bcrypt.compare(newPassword, current.password), true);
    assert.equal(await bcrypt.compare(oldPassword, current.password), false);
    assert.equal(current.sessionVersion, 1);
    assert.equal((await self(oldSignIn.accessToken)).status, 401);
    await assert.rejects(() => authService.refresh(oldSignIn.refreshToken), { statusCode: 401 });
    await assert.rejects(() => authService.login(staff.email, oldPassword), { statusCode: 401 });
    const newSignIn = await authService.login(staff.email, newPassword);
    assert.equal((await self(newSignIn.accessToken)).status, 200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: orgA.id, actorId: admin.id, action: "auth.staff.password.reset.success", entityId: staff.id } });
    assert.equal(audit.scope, "TENANT");
    const publicOutput = JSON.stringify({ payload, metadata: audit.metadata });
    for (const secret of [newPassword, adminPassword, oldPassword, current.password]) assert.ok(!publicOutput.includes(secret));
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: foreign.id } })).password, foreign.password);

    auditService.recordInTransaction = async (db, input) => {
      if (input.action === "auth.staff.password.reset.success") throw new Error("Isolated audit failure");
      return originalAudit.call(auditService, db, input);
    };
    const next = `Next-${tag}A1`;
    assert.equal((await reset(staff.id, { ...body, newPassword: next, confirmPassword: next })).status, 500);
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: staff.id } });
    assert.equal(unchanged.password, current.password);
    assert.equal(unchanged.sessionVersion, 1);
    assert.equal((await self(newSignIn.accessToken)).status, 200);
    assert.equal(await prisma.refreshToken.count({ where: { userId: staff.id, organizationId: orgA.id } }), 1);
  } finally {
    auditService.recordInTransaction = originalAudit;
    if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    await prisma.$disconnect(); redis.disconnect();
  }
});
