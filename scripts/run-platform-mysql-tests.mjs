// Provisions an isolated test database, deploys migrations there, and runs real locks/constraints.
// Never reset or drop a database. Fixtures and immutable audit history are retained.
import "dotenv/config";
import mariadb from "mariadb";
import { spawnSync } from "node:child_process";

const target = process.env.PLATFORM_TEST_DATABASE_NAME ?? "";
if (!process.argv.includes("--isolated-test-database") || !/^service_flow_platform_test_[a-z0-9_]+$/.test(target) || target === process.env.DATABASE_NAME) {
  throw new Error("Choose an isolated PLATFORM_TEST_DATABASE_NAME beginning service_flow_platform_test_ and acknowledge --isolated-test-database");
}
const url = new URL(process.env.DATABASE_URL);
url.pathname = `/${target}`;
const testEnvironment = { ...process.env, NODE_ENV: "test", LOG_LEVEL: "error", DATABASE_NAME: target,
  DATABASE_URL: url.toString(), PLATFORM_TEST_DATABASE_NAME: target, RUN_DB_PLATFORM_TESTS: "1" };
let connection;
try {
  connection = await mariadb.createConnection({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, allowPublicKeyRetrieval: true, connectTimeout: 5000 });
  // Identifier is restricted by the regex above. No user-supplied SQL fragments are accepted.
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${target}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.end(); connection = undefined;
  const feedbackOnly = process.argv.includes("--feedback-only");
  const brandingOnly = process.argv.includes("--branding-only");
  const suites = brandingOnly ? [
    ["--import", "tsx", "tests/organization/mysql.integration.mjs"],
  ] : feedbackOnly ? [
    ["--import", "tsx", "tests/feedback/mysql.integration.mjs"],
  ] : [
    ["--import", "tsx", "tests/system-admin/signup.mysql.mjs"],
    ["--import", "tsx", "tests/system-admin/mysql.integration.mjs"],
    ["--import", "tsx", "tests/system-admin/trials.mysql.mjs"],
    ["--import", "tsx", "tests/user/password-reset.mysql.mjs"],
    ["--import", "tsx", "tests/system-admin/operations.mysql.mjs"],
    ["--import", "tsx", "tests/system-admin/cli.mysql.mjs"],
    ["--import", "tsx", "tests/feedback/mysql.integration.mjs"],
    ["--import", "tsx", "tests/organization/mysql.integration.mjs"],
  ];
  for (const args of [
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    ...suites,
  ]) {
    const result = spawnSync(process.execPath, args, { env: testEnvironment, stdio: "inherit" });
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
  }
} catch {
  console.error("Isolated MySQL verification failed. Check test database provisioning permissions and connectivity; no database was reset or dropped.");
  process.exitCode = 1;
} finally { if (connection) await connection.end(); }
