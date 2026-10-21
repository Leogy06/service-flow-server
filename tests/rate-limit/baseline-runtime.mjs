// Isolated, read-only application diagnosis: only a dedicated local Redis is used.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import process from "node:process";
import console from "node:console";
import { URL } from "node:url";
import { setTimeout } from "node:timers";
import express from "express";
const { fetch } = globalThis;

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "mysql://fixture:fixture@127.0.0.1:1/rate_limit_fixture",
  REDIS_URL: "redis://127.0.0.1:16379",
  CORS_ORIGIN: "http://localhost:3000",
  JWT_ACCESS_SECRET: "rate-limit-fixture-access",
  JWT_REFRESH_SECRET: "rate-limit-fixture-refresh",
  RESEND_API_KEY: "fixture-unused",
  EMAIL_FROM: "Fixture <fixture@example.com>",
  TRUST_PROXY_HOPS: "0",
});

const { apiLimiter, authLimiter } = await import("../../src/middleware/rateLimiter.ts");
const { errorHandler } = await import("../../src/middleware/errorHandler.ts");
const { redis } = await import("../../src/lib/redis.ts");
const app = express();
app.set("trust proxy", 0);
let observed;
app.use("/api", (req, _res, next) => {
  observed ??= { ip: req.ip, forwardedFor: req.get("X-Forwarded-For"), authenticatedBeforeLimiter: Boolean(req.user) };
  next();
});
app.use("/api", apiLimiter);
app.get("/api/items", (req, res) => res.json({ fixtureUser: req.get("X-Fixture-User") }));
app.post("/api/auth/refresh", authLimiter, (_req, res) => res.json({ fixture: true }));
app.post("/api/auth/login", authLimiter, (_req, res) => res.json({ fixture: true }));
app.use(errorHandler);

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const headers = (response) => Object.fromEntries([...response.headers].filter(([key]) => key.startsWith("ratelimit") || key === "retry-after"));
const report = { mode: "isolated real Redis and unchanged source middleware; fixture responses; no database", observed: null, browsing: [], refresh: [], loginAfterRefresh: null };
try {
  for (let attempt = 0; ; attempt++) {
    try { await redis.ping(); break; } catch (error) {
      if (attempt >= 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  // No FLUSHDB: this Redis container was created exclusively for this script.
  for (const user of ["fixture-user-a", "fixture-user-b"]) {
    const response = await fetch(origin + "/api/items", { headers: { "X-Fixture-User": user, "X-Forwarded-For": "198.51.100.42" } });
    assert.equal(response.status, 200);
    report.browsing.push({ user, status: response.status, headers: headers(response) });
    await response.text();
  }
  for (let number = 1; number <= 10; number++) {
    const response = await fetch(origin + "/api/auth/refresh", { method: "POST" });
    assert.equal(response.status, 200);
    report.refresh.push({ number, status: response.status, headers: headers(response) });
    await response.text();
  }
  const login = await fetch(origin + "/api/auth/login", { method: "POST" });
  assert.equal(login.status, 429);
  report.loginAfterRefresh = { status: login.status, headers: headers(login), body: await login.json() };
  report.observed = observed;
  const target = new URL("../../../artifacts/rate-limit-20261021/", import.meta.url);
  await mkdir(target, { recursive: true });
  await writeFile(new URL("baseline-runtime.json", target), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  redis.disconnect();
}
