// Fixture controllers and identity stand in for MySQL; rate-limit/store/client code is real.
import assert from "node:assert/strict";
import process from "node:process";
import { setTimeout } from "node:timers";
import express from "express";

assert.equal(process.env.RATE_LIMIT_FIXTURE, "isolated-local-only");
assert.equal(process.env.REDIS_URL, "redis://127.0.0.1:16379");
assert.equal(process.env.NODE_ENV, "test");
const { apiLimiter, authLimiter, refreshLimiter } = await import("../../src/middleware/rateLimiter.ts");
const { errorHandler } = await import("../../src/middleware/errorHandler.ts");
const { redis } = await import("../../src/lib/redis.ts");
const app = express();
app.set("trust proxy", 0);
app.post("/api/auth/login", authLimiter, (req, res) => {
  res.status(req.get("X-Fixture-Failed-Login") ? 401 : 200).json({ fixture: true });
});
app.post("/api/auth/login-decrement-outage", authLimiter, (_req, res) => {
  // Disconnect only this fixture's client after increment and before finish-event decrement.
  redis.disconnect();
  res.json({ fixture: true });
  setTimeout(() => { void redis.connect().catch(() => {}); }, 200);
});
app.post("/api/auth/refresh", refreshLimiter, (_req, res) => res.json({ fixture: true }));
app.use("/api", (req, _res, next) => {
  const id = req.get("X-Fixture-User");
  if (id) req.user = { id };
  next();
}, apiLimiter);
app.get("/api/fixture-read", (_req, res) => res.json({ fixture: true }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/_fixture/alive", (_req, res) => res.json({ fixture: true }));
app.use(errorHandler);

const server = app.listen(0, "127.0.0.1", () => {
  process.send?.({ origin: `http://127.0.0.1:${server.address().port}`, redisStatusAtListen: redis.status });
});
process.on("message", (message) => {
  if (message === "redis-status") process.send?.({ redisStatus: redis.status });
  if (message !== "stop") return;
  server.closeAllConnections();
  server.close(() => {
    redis.disconnect();
    process.disconnect?.();
  });
});
