// Run after building/fixing the middleware. Uses dedicated Redis on 16379, never MySQL.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { setTimeout } from "node:timers";
import process from "node:process";
import console from "node:console";
import jwt from "jsonwebtoken";
const { fetch } = globalThis;

const name = `rate-test-${Date.now()}`;
const environment = {
  ...process.env,
  RATE_LIMIT_FIXTURE: "isolated-local-only",
  NODE_ENV: "test", APP_ENV: name,
  DATABASE_URL: "mysql://fixture:fixture@127.0.0.1:1/rate_limit_fixture",
  REDIS_URL: "redis://127.0.0.1:16379", CORS_ORIGIN: "http://localhost:3000",
  JWT_ACCESS_SECRET: "rate-limit-fixture-access", JWT_REFRESH_SECRET: "rate-limit-fixture-refresh",
  RESEND_API_KEY: "fixture-unused", EMAIL_FROM: "Fixture <fixture@example.com>",
  TRUST_PROXY_HOPS: "0", REDIS_CONNECT_TIMEOUT_MS: "300", REDIS_COMMAND_TIMEOUT_MS: "300",
  API_RATE_LIMIT_MAX: "3", AUTH_RATE_LIMIT_MAX: "3", REFRESH_RATE_LIMIT_MAX: "3",
};
const children = [];
const report = { mode: "two independent Express processes; real isolated Redis; fixture auth/controllers; no database", namespace: name, checks: [] };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function start() {
  const child = fork(fileURLToPath(new URL("./runtime-fixture.mjs", import.meta.url)), [], {
    env: environment, execArgv: ["--import", "tsx"], windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output = (output + data).slice(-3000); });
  const ready = await Promise.race([
    once(child, "message").then(([message]) => message),
    once(child, "exit").then(([code]) => { throw new Error(`Fixture exited ${code}: ${output}`); }),
    delay(10000).then(() => { throw new Error("Fixture startup timed out"); }),
  ]);
  assert.ok(ready.origin);
  return { child, origin: ready.origin, redisStatusAtListen: ready.redisStatusAtListen };
}
async function request(instance, path, headers = {}) {
  const response = await fetch(instance.origin + path, { method: path.startsWith("/api/auth/") ? "POST" : "GET", headers });
  const body = await response.json();
  return { status: response.status, body, headers: Object.fromEntries([...response.headers].filter(([key]) => key.startsWith("ratelimit") || key === "retry-after")) };
}
async function check(label, run) {
  const result = await run();
  report.checks.push({ label, passed: true, ...result });
}
async function waitUntilRedisReady(instance) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const message = once(instance.child, "message");
    instance.child.send("redis-status");
    const [state] = await message;
    if (state.redisStatus === "ready") return;
    await delay(100);
  }
  throw new Error("Redis did not recover in 60 seconds");
}
async function save(filename) {
  const target = new URL("../../../artifacts/rate-limit-20261021/", import.meta.url);
  await mkdir(target, { recursive: true });
  await writeFile(new URL(filename, target), JSON.stringify(report, null, 2) + "\n");
}
try {
  const one = await start();
  const two = await start();
  if (process.argv.includes("--outage")) {
    await check("cold-start Redis outage: browsing fails open, login fails closed", async () => {
      const read = await request(one, "/api/fixture-read", { "X-Fixture-User": "outage-user" });
      const login = await request(two, "/api/auth/login");
      assert.equal(read.status, 200);
      assert.ok(login.status >= 500);
      return { read, login };
    });
    console.log("OUTAGE_CHECKED: start only serviceflow-rate-audit-20261021 within 60 seconds; recovery is detected automatically");
    await waitUntilRedisReady(one);
    await waitUntilRedisReady(two);
    await check("same processes recover from failed cold-start SCRIPT LOAD", async () => {
      const login = await request(one, "/api/auth/login");
      assert.equal(login.status, 200);
      const failed = await request(two, "/api/auth/login", { "X-Fixture-Failed-Login": "1" });
      assert.equal(failed.status, 401);
      return { login, failed };
    });
    await check("Redis failure during successful-login decrement does not crash the process", async () => {
      const login = await request(one, "/api/auth/login-decrement-outage");
      assert.equal(login.status, 200);
      await delay(50);
      const alive = await request(one, "/_fixture/alive");
      assert.equal(alive.status, 200);
      await waitUntilRedisReady(one);
      return { login, alive };
    });
    await save("runtime-outage.json");
  } else {
    await check("first healthy login succeeds without an external Redis-ready wait", async () => {
      const login = await request(two, "/api/auth/login");
      assert.equal(login.status, 200);
      return { redisStatusAtListen: two.redisStatusAtListen, login };
    });
    await check("two Express processes share user counters", async () => {
      const responses = [];
      for (const instance of [one, two, one, two]) responses.push(await request(instance, "/api/fixture-read", { "X-Fixture-User": "user-a" }));
      assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 429]);
      assert.deepEqual(responses.slice(0, 3).map((response) => response.headers["ratelimit-remaining"]), ["2", "1", "0"]);
      assert.ok(Number(responses[3].headers["retry-after"]) > 0);
      assert.ok(responses[3].body.retryAfterSeconds > 0);
      return { responses };
    });
    await check("another user sharing the same IP retains a separate budget", async () => {
      const response = await request(two, "/api/fixture-read", { "X-Fixture-User": "user-b" });
      assert.equal(response.status, 200);
      assert.equal(response.headers["ratelimit-remaining"], "2");
      return { response };
    });
    await check("health bypasses an exhausted browsing bucket", async () => {
      const response = await request(one, "/api/health", { "X-Fixture-User": "user-a" });
      assert.equal(response.status, 200);
      assert.equal(response.headers["ratelimit-remaining"], undefined);
      return { response };
    });
    await check("refresh shares a user counter across instances independently of login", async () => {
      const bearer = jwt.sign({ sub: "refresh-user" }, environment.JWT_ACCESS_SECRET, { algorithm: "HS256", expiresIn: -1 });
      const responses = [];
      for (const instance of [one, two, one, two]) responses.push(await request(instance, "/api/auth/refresh", { Authorization: `Bearer ${bearer}` }));
      assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 429]);
      const login = await request(one, "/api/auth/login");
      assert.equal(login.status, 200);
      return { responses, login };
    });
    await check("successful login responses restore the login budget", async () => {
      const responses = [];
      for (let number = 0; number < 6; number++) {
        const response = await request(number % 2 ? one : two, "/api/auth/login");
        assert.equal(response.status, 200);
        responses.push(response);
        await delay(20); // wait for the real finish-event decrement to settle
      }
      return { responses };
    });
    await check("failed login attempts remain blocked across both processes", async () => {
      const responses = [];
      for (const instance of [one, two, one, two]) responses.push(await request(instance, "/api/auth/login", { "X-Fixture-Failed-Login": "1" }));
      assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 429]);
      return { responses };
    });
    await save("runtime-two-process.json");
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.send("stop");
    await exited;
  }));
}
