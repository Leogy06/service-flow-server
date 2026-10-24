// Only disposable, uniquely labelled local containers are created and removed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import mariadb from "mariadb";

if (!process.argv.includes("--isolated-test-containers")) throw new Error("Pass --isolated-test-containers to acknowledge disposable local verification");
const backend = fileURLToPath(new URL("../", import.meta.url));
const evidence = resolve(backend, "../artifacts/tenant-onboarding/mysql");
await mkdir(evidence, { recursive: true });
const nonce = randomBytes(6).toString("hex");
const password = randomBytes(32).toString("hex");
const database = `service_flow_platform_test_provisioning_${nonce}`;
const names = [];
const results = [];
let connection;
function run(binary, args, environment = process.env, logName) {
  const result = spawnSync(binary, args, { cwd: backend, env: environment, encoding: "utf8", windowsHide: true, timeout: 240000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[REDACTED]");
  if (logName) writeFileSync(resolve(evidence, logName), output);
  if (result.error || result.status !== 0) throw new Error(`${binary} failed (${result.error?.code ?? result.status}): ${output.slice(-2000)}`);
  return output;
}
async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const value = server.address().port;
  await new Promise(done => server.close(done));
  return value;
}
try {
  const mysqlPort = await freePort(), redisPort = await freePort();
  const environment = { ...process.env, NODE_ENV: "test", LOG_LEVEL: "fatal",
    NODE_OPTIONS: `--import=${pathToFileURL(resolve(backend, "tests/audit/no-private-env.mjs")).href}`,
    MYSQL_ROOT_PASSWORD: password, MYSQL_ROOT_HOST: "%", MYSQL_DATABASE: database,
    DATABASE_URL: `mysql://root:${password}@127.0.0.1:${mysqlPort}/${database}?connection_limit=5`,
    DATABASE_NAME: database, PLATFORM_TEST_DATABASE_NAME: database,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`, CORS_ORIGIN: "http://localhost:3000",
    JWT_ACCESS_SECRET: "synthetic-onboarding-access-secret-at-least-32-characters",
    JWT_REFRESH_SECRET: "synthetic-onboarding-refresh-secret-at-least-32-characters",
    RESEND_API_KEY: "re_inert_onboarding_no_email", EMAIL_FROM: "Test <test@example.invalid>",
    RUN_DB_PLATFORM_TESTS: "1", SERVICEFLOW_AUDIT_BUSINESS_TEST: "1" };
  for (const key of ["DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_CA"]) delete environment[key];
  for (const [kind, args] of [
    ["mysql", ["--memory", "1g", "-p", `127.0.0.1:${mysqlPort}:3306`, "-e", "MYSQL_ROOT_PASSWORD", "-e", "MYSQL_ROOT_HOST", "-e", "MYSQL_DATABASE", "mysql:8.4", "--lower-case-table-names=0", "--innodb-buffer-pool-size=134217728", "--performance-schema=OFF"]],
    ["redis", ["-p", `127.0.0.1:${redisPort}:6379`, "redis:7-alpine"]],
  ]) {
    const name = `serviceflow-provisioning-${kind}-${nonce}`;
    run("docker", ["run", "-d", "--name", name, "--label", `serviceflow.provisioning-test=${nonce}`, ...args], environment);
    names.push(name);
  }
  for (let attempt = 0; attempt < 180; attempt++) {
    try {
      connection = await mariadb.createConnection({ host: "127.0.0.1", port: mysqlPort, user: "root", password, database, allowPublicKeyRetrieval: true, connectTimeout: 1000 });
      break;
    } catch {
      await delay(1000);
    }
  }
  if (!connection) throw new Error("Disposable MySQL did not become available within the startup deadline");
  const migrationLog = run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "import{commandPlan,executePlan}from'./scripts/prisma.mjs';process.exitCode=await executePlan(commandPlan(['dev','migrate','deploy']),process.env);"], environment);
  await writeFile(resolve(evidence, "migrations.log"), migrationLog);
  results.push({ name: "fresh exact-case MySQL migration replay", status: "PASS" });
  for (const file of ["tests/system-admin/provisioning.mysql.mjs", "tests/system-admin/signup.mysql.mjs"]) {
    run(process.execPath, ["--import", "tsx", file], environment, file.includes("provisioning") ? "provisioning.log" : "signup.log");
    results.push({ name: file, status: "PASS" });
    console.log(`PASS ${file}`);
  }
} catch (error) {
  process.exitCode = 1;
  results.push({ name: "isolated provisioning acceptance", status: "FAIL", reason: error.message.replaceAll(password, "[REDACTED]") });
  console.error(results.at(-1).reason);
} finally {
  await connection?.end();
  for (const name of names.reverse()) {
    const owner = run("docker", ["inspect", "--format", '{{index .Config.Labels "serviceflow.provisioning-test"}}', name]).trim();
    assert.equal(owner, nonce, "Refusing to remove a container not owned by this run");
    run("docker", ["rm", "-f", "-v", name]);
  }
  await writeFile(resolve(evidence, "results.json"), JSON.stringify({ completed: true, exitCode: process.exitCode ?? 0, results }, null, 2) + "\n");
}
