import assert from "node:assert/strict";
import { test } from "node:test";
import { assertLocalServices, createRedactor, resultExitCode } from "./predeploy-utils.mjs";

const local = { DATABASE_URL: "mysql://tester:sample@127.0.0.1:3306/test_db",
  DATABASE_HOST: "localhost", DATABASE_PORT: "3306", DATABASE_NAME: "test_db",
  DATABASE_USER: "tester", DATABASE_PASSWORD: "sample", REDIS_URL: "redis://localhost:6379" };

test("service probes reject remote endpoints and mismatched CLI/runtime targets", () => {
  assert.doesNotThrow(() => assertLocalServices(local));
  for (const changed of [
    { DATABASE_HOST: "db.example.com" }, { DATABASE_URL: "mysql://tester:sample@remote.example.com/test_db" },
    { REDIS_URL: "redis://remote.example.com" }, { DATABASE_NAME: "another_db" },
    { DATABASE_PORT: "3307" }, { DATABASE_PASSWORD: "different" }, { DATABASE_USER: "other" },
  ]) assert.throws(() => assertLocalServices({ ...local, ...changed }));
});

test("reports redact secrets and URL credentials without treating token durations as secrets", () => {
  const { redact, add } = createRedactor({ ...local, JWT_ACCESS_SECRET: "secret-value", REFRESH_TOKEN_DAYS: "7" });
  add("isolated-db-password");
  const result = redact("secret-value isolated-db-password mysql://user:other-password@localhost/db 2026-10-17 7");
  assert.ok(!result.includes("secret-value") && !result.includes("isolated-db-password") && !result.includes("other-password"));
  assert.ok(result.includes("2026-10-17 7"));
});

test("blocked checks cannot produce a successful exit code", () => {
  assert.equal(resultExitCode([{ status: "PASS" }]), 0);
  assert.equal(resultExitCode([{ status: "PASS" }, { status: "BLOCKED" }]), 2);
  assert.equal(resultExitCode([{ status: "BLOCKED" }, { status: "FAIL" }]), 1);
});
