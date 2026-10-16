import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
const databaseName = process.env.DATABASE_NAME ?? "";
if (process.env.NODE_ENV !== "test" || process.env.RUN_DB_PLATFORM_TESTS !== "1" ||
  !/^service_flow_platform_test_[a-z0-9_]+$/.test(databaseName) || process.env.PLATFORM_TEST_DATABASE_NAME !== databaseName ||
  new URL(process.env.DATABASE_URL).pathname !== `/${databaseName}`) throw new Error("Isolated platform test database required");
const { prisma } = await import("../../src/lib/prisma.ts");
const { authService } = await import("../../src/modules/auth/auth.service.ts");

test("compiled provisioning and scheduler CLIs work without tsx in the runtime and never promote existing users", { timeout: 60000 }, async () => {
  const email = `bootstrap-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("hex");
  const env = { ...process.env, SYSTEM_ADMIN_EMAIL: email, SYSTEM_ADMIN_PASSWORD: password, SYSTEM_ADMIN_REASON: "Isolated compiled CLI integration check" };
  const invoke = (args, environment = env) => spawnSync(process.execPath, args, { env: environment, encoding: "utf8", timeout: 30000 });
  try {
    const first = invoke(["dist/modules/system-admin/bootstrap.cli.js", "--bootstrap-system-admin"]);
    assert.equal(first.status, 0, "Compiled bootstrap failed");
    assert.ok(!(first.stdout + first.stderr).includes(password));
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(user.platformRole, "SYSTEM_ADMIN"); assert.equal(user.organizationId, null); assert.equal(user.securityStatus, "ACTIVE");
    assert.notEqual(user.password, password); assert.ok(await bcrypt.compare(password, user.password));
    const login = await authService.login(email, password);
    assert.equal(login.user.platformRole, "SYSTEM_ADMIN"); assert.equal(login.organization, null);
    assert.equal((await authService.refresh(login.refreshToken)).accessToken.length > 0, true);
    const duplicate = invoke(["dist/modules/system-admin/bootstrap.cli.js", "--bootstrap-system-admin"]);
    assert.equal(duplicate.status, 1);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { email } })).password, user.password);
    assert.equal(await prisma.auditLog.count({ where: { entityId: user.id, action: "platform.admin.bootstrap", scope: "PLATFORM" } }), 1);
    const unacknowledgedEmail = `unacknowledged-${randomUUID()}@example.invalid`;
    assert.equal(invoke(["dist/modules/system-admin/bootstrap.cli.js"], { ...env, SYSTEM_ADMIN_EMAIL: unacknowledgedEmail }).status, 1);
    assert.equal(await prisma.user.count({ where: { email: unacknowledgedEmail } }), 0);
    assert.equal(invoke(["dist/modules/system-admin/process-alerts.cli.js"]).status, 0);
  } finally { await prisma.$disconnect(); }
});
