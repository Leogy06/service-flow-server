import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import mariadb from "mariadb";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { tsImport } from "tsx/esm/api";

if (!process.argv.includes("--isolated-audit-containers")) throw new Error("Explicit isolated container acknowledgement required");
const backend = fileURLToPath(new URL("../../", import.meta.url));
const evidence = resolve(backend, "../docs/audits/evidence/mysql");
await mkdir(evidence, { recursive: true });
const nonce = randomBytes(6).toString("hex");
const password = randomBytes(32).toString("hex");
const mysqlName = `serviceflow-audit-mysql-${nonce}`;
const redisName = `serviceflow-audit-redis-${nonce}`;
const database = `service_flow_platform_test_audit_${nonce}`;
const names = [];
const results = [];
let connection, prisma, connectionFailure;

function run(binary, args, environment = process.env, log) {
  const result = spawnSync(binary, args, { cwd: backend, env: environment, encoding: "utf8", windowsHide: true, timeout: 240000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[REDACTED]");
  if (log) return writeFile(resolve(evidence, log), output).then(() => {
    if (result.error || result.status !== 0) throw new Error(`${binary} failed; inspect ${log} (${result.error?.code ?? result.status})`);
    return output;
  });
  if (result.error || result.status !== 0) throw new Error(`${binary} failed (${result.error?.code ?? result.status}): ${output.slice(-500)}`);
  return output;
}
async function port() {
  const server = createServer();
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const selected = server.address().port;
  await new Promise(done => server.close(done));
  return selected;
}
function passed(name) { results.push({ name, status: "PASS" }); console.log(`PASS ${name}`); }

try {
  const mysqlPort = await port(), redisPort = await port();
  const environment = { ...process.env, NODE_ENV: "test", LOG_LEVEL: "fatal",
    NODE_OPTIONS: `--import=${pathToFileURL(resolve(backend, "tests/audit/no-private-env.mjs")).href}`,
    MYSQL_ROOT_PASSWORD: password, MYSQL_ROOT_HOST: "%", MYSQL_DATABASE: database,
    DATABASE_URL: `mysql://root:${password}@127.0.0.1:${mysqlPort}/${database}?connection_limit=5`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`, CORS_ORIGIN: "http://localhost:3000",
    JWT_ACCESS_SECRET: "synthetic-audit-access-secret-at-least-32-characters",
    JWT_REFRESH_SECRET: "synthetic-audit-refresh-secret-at-least-32-characters",
    RESEND_API_KEY: "re_inert_audit_no_email", EMAIL_FROM: "Audit <audit@example.invalid>",
    RUN_DB_WORKFLOW_TESTS: "1", RUN_DB_SERVICE_REQUEST_TESTS: "1", RUN_DB_ACCESS_TESTS: "1",
    SERVICEFLOW_AUDIT_BUSINESS_TEST: "1",
    PLATFORM_TEST_DATABASE_NAME: database,
  };
  for (const key of ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_CA"]) delete environment[key];
  await run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "await import('../frontend/app/lib/api/client.ts');"], environment, "frontend-client-loader.log");
  for (const [name, args] of [
    [mysqlName, ["--memory", "1g", "-p", `127.0.0.1:${mysqlPort}:3306`, "-e", "MYSQL_ROOT_PASSWORD", "-e", "MYSQL_ROOT_HOST", "-e", "MYSQL_DATABASE", "mysql:8.4", "--lower-case-table-names=0", "--innodb-buffer-pool-size=134217728", "--performance-schema=OFF"]],
    [redisName, ["-p", `127.0.0.1:${redisPort}:6379`, "redis:7-alpine"]],
  ]) {
    run("docker", ["run", "-d", "--name", name, "--label", `serviceflow.audit=${nonce}`, ...args], environment);
    names.push(name);
  }
  // Cold Docker Desktop initialization exceeded 90s under a concurrent Next
  // build. Allow 180 bounded connection attempts; functional tests keep deadlines.
  for (let attempt = 0; attempt < 180; attempt++) {
    try { connection = await mariadb.createConnection({ host: "127.0.0.1", port: mysqlPort, user: "root", password, database, allowPublicKeyRetrieval: true, connectTimeout: 1000 }); break; }
    catch (error) { connectionFailure = `${error.code ?? "connection"}: ${error.message}`.replaceAll(password, "[REDACTED]"); await delay(1000); }
  }
  assert.ok(connection, `Isolated MySQL did not become ready: ${connectionFailure}`);
  await run(process.execPath, ["--input-type=module", "-e", "import{commandPlan,executePlan}from'./scripts/prisma.mjs';process.exitCode=await executePlan(commandPlan(['dev','migrate','deploy']),process.env);"], environment, "fresh-migrations.log");
  const expected = (await readdir(resolve(backend, "prisma/migrations"), { withFileTypes: true })).filter(item => item.isDirectory()).length;
  const [history] = await connection.query("SELECT COUNT(*) AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL");
  assert.equal(Number(history.count), expected);
  passed(`fresh Linux MySQL casing=0 replay: ${expected} migrations`);
  const { PrismaClient } = await tsImport("../../src/generated/prisma/client.ts", import.meta.url);
  prisma = new PrismaClient({ adapter: new PrismaMariaDb({ host: "127.0.0.1", port: mysqlPort, user: "root", password, database, allowPublicKeyRetrieval: true, connectionLimit: 3 }) });
  for (const key of ["a", "b"]) await prisma.organization.create({ data: { id: `audit-${key}`, name: `Audit ${key}`, slug: `audit-${key}` } });
  const customer = { name: "Shared Customer", email: "shared@example.invalid", phoneNumber: "09179990000" };
  await prisma.customer.create({ data: { id: "audit-customer-a", organizationId: "audit-a", ...customer } });
  await prisma.customer.create({ data: { id: "audit-customer-b", organizationId: "audit-b", ...customer } });
  await assert.rejects(prisma.customer.create({ data: { organizationId: "audit-a", ...customer } }), error => error.code === "P2002");
  await prisma.customer.update({ where: { id: "audit-customer-a" }, data: { deletedAt: new Date() } });
  await assert.rejects(prisma.customer.create({ data: { organizationId: "audit-a", ...customer } }), error => error.code === "P2002");
  passed("real MySQL tenant-compound duplicates and archived reservations");
  const duplicateRace = await Promise.allSettled([1, 2].map(() => prisma.customer.create({ data: {
    organizationId: "audit-a", name: "Race Customer", email: "race@example.invalid", phoneNumber: "09179990001",
  } })));
  assert.equal(duplicateRace.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(duplicateRace.filter(result => result.status === "rejected" && result.reason.code === "P2002").length, 1);
  passed("concurrent same-tenant customer duplicate commits exactly once");
  // Simulate the previous index layout on this disposable database only, then
  // apply the exact new migration over a retained populated customer row.
  await prisma.customer.delete({ where: { id: "audit-customer-b" } });
  // MySQL may have replaced its implicit organization FK index with the first
  // compound key. Restore FK support while simulating the old index layout.
  await connection.query("ALTER TABLE `Customer` ADD INDEX `Customer_audit_upgrade_org_idx` (`organizationId`), ADD UNIQUE INDEX `Customer_name_key` (`name`), ADD UNIQUE INDEX `Customer_email_key` (`email`), ADD UNIQUE INDEX `Customer_phoneNumber_key` (`phoneNumber`), DROP INDEX `Customer_organizationId_name_key`, DROP INDEX `Customer_organizationId_email_key`, DROP INDEX `Customer_organizationId_phoneNumber_key`");
  const sql = await readFile(resolve(backend, "prisma/migrations/20261024090000_customer_tenant_uniqueness/migration.sql"), "utf8");
  await connection.query(sql);
  assert.equal((await prisma.customer.findUnique({ where: { id: "audit-customer-a" } })).email, customer.email);
  await prisma.customer.create({ data: { id: "audit-upgrade-b", organizationId: "audit-b", ...customer } });
  passed("populated customer index upgrade preserves row and permits cross-tenant reuse");
  await prisma.$disconnect(); prisma = undefined;
  for (const [file, log] of [
    ["tests/service-request/mysql.integration.mjs", "service-requests.log"],
    ["tests/workflow/mysql.integration.mjs", "workflow.log"],
    ["tests/access-management/mysql.integration.mjs", "access-management.log"],
  ]) {
    try {
      await run(process.execPath, ["--import", "tsx", file], environment, log);
      passed(file);
    } catch (error) {
      results.push({ name: file, status: "FAIL", reason: error.message });
      process.exitCode = 1;
      console.error(`FAIL ${file}; inspect ${log}`);
    }
  }
} catch (error) {
  if (names.includes(mysqlName)) {
    try { await writeFile(resolve(evidence, "mysql-startup.log"), run("docker", ["logs", mysqlName])); } catch { /* Preserve the original failure. */ }
  }
  results.push({ name: "isolated acceptance", status: "FAIL", reason: error.message.replaceAll(password, "[REDACTED]") });
  console.error(results.at(-1).reason);
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
  await connection?.end();
  for (const name of names.reverse()) {
    // Delete only test-owned containers and their anonymous volumes after
    // verifying both their exact names and unique ownership label.
    const owner = run("docker", ["inspect", "--format", '{{index .Config.Labels "serviceflow.audit"}}', name]).trim();
    assert.equal(owner, nonce, "Refusing to clean up a container not owned by this run");
    run("docker", ["rm", "-f", "-v", name]);
  }
  await writeFile(resolve(evidence, "results.json"), JSON.stringify({ completed: true, exitCode: process.exitCode ?? 0, results }, null, 2) + "\n");
}
