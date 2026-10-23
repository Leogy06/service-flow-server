import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

// This writes synthetic traffic only to the configured local development database.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
process.env.CRON_SECRET = randomUUID();
process.env.INTERNAL_API_SECRET = randomUUID();
const { env } = await import("../../src/config/env.ts");
const host = env.DB_HOST ?? new URL(env.DATABASE_URL).hostname;
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(host), "This verification requires a local database");
const { app } = await import("../../src/app.ts");
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
const path = `/api/access-log-check-${randomUUID()}`;

async function curl(suffix, headers = {}) {
  const args = ["--silent", "--show-error", "--output", "NUL", "--write-out", "%{http_code}", `${base}${suffix}`];
  for (const [name, value] of Object.entries(headers)) args.push("-H", `${name}: ${value}`);
  const child = spawn(process.platform === "win32" ? "curl.exe" : "curl", args);
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  const [code] = await once(child, "close");
  assert.equal(code, 0, "curl failed");
  return Number(output);
}
async function rowFor(suffix) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const row = await prisma.accessLog.findFirst({ where: { path: path + suffix } });
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Missing access log for ${suffix}`);
}
async function admin(suffix, token) {
  const response = await fetch(`${base}/api/admin/access-logs${suffix}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: response.status, body: await response.json() };
}
try {
  const operator = await prisma.user.findFirst({ where: { platformRole: "SYSTEM_ADMIN", organizationId: null, status: "ACTIVE", deletedAt: null, securityStatus: "ACTIVE" }, include: { role: true } });
  assert.ok(operator, "An existing active local platform administrator is required");
  const token = generateAccessToken({ ...operator, role: operator.role.name });
  assert.equal(await curl(path, { "x-vercel-forwarded-for": "203.0.113.42", "x-vercel-ip-country": "PH", "x-vercel-ip-city": "General%20Santos" }), 404);
  const row = await rowFor("");
  assert.equal(row.ip, "203.0.113.42"); assert.equal(row.country, "PH"); assert.equal(row.city, "General Santos");
  assert.equal(await curl(path + "-local"), 404);
  assert.match((await rowFor("-local")).ip, /127\.0\.0\.1|::1/);
  assert.equal(await curl(path + "-internal", { "x-client-ip": "192.0.2.88", "x-internal-api-secret": env.INTERNAL_API_SECRET }), 404);
  assert.equal((await rowFor("-internal")).ip, "192.0.2.88");
  assert.equal(await curl(path + "-spoof", { "x-client-ip": "192.0.2.99" }), 404);
  assert.notEqual((await rowFor("-spoof")).ip, "192.0.2.99");
  for (const suffix of ["", "/top-ips"]) assert.equal((await admin(suffix)).status, 401);
  const list = await admin("?ip=203.0.113.42&page=1&limit=200", token);
  assert.equal(list.status, 200);
  assert.ok(list.body.data.items.some((item) => item.id === row.id && item.createdAt && item.durationMs >= 0));
  assert.ok(list.body.data.items.every((item) => item.ip === "203.0.113.42"));
  const top = await admin("/top-ips", token);
  assert.equal(top.status, 200);
  assert.ok(top.body.data.some((item) => item.ip === row.ip && item.country === "PH" && item.hitCount >= 1 && item.lastSeen));
  const alias = await fetch(`${base}/api/system-admin/access-logs?ip=203.0.113.42`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(alias.status, 200);
  assert.equal(await prisma.accessLog.count({ where: { path: { startsWith: "/api/admin" } } }), 0);
  const tenant = await prisma.user.findFirst({ where: { platformRole: "NONE", organizationId: { not: null }, status: "ACTIVE", deletedAt: null, securityStatus: "ACTIVE" }, include: { role: true } });
  if (tenant) {
    const denied = await admin("", generateAccessToken({ ...tenant, role: tenant.role.name }));
    assert.notEqual(denied.status, 200);
  }
  const expired = await prisma.accessLog.create({ data: { ip: "192.0.2.1", method: "GET", path: path + "-expired", status: 200, durationMs: 0, createdAt: new Date(Date.now() - 31 * 86400_000) } });
  assert.equal((await fetch(`${base}/api/cron/access-logs`)).status, 401);
  const cron = await fetch(`${base}/api/cron/access-logs`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
  assert.equal(cron.status, 200);
  assert.equal(await prisma.accessLog.findUnique({ where: { id: expired.id } }), null);
  assert.ok(await prisma.accessLog.findUnique({ where: { id: row.id } }));
  console.log("PASS: real local Express + curl + MySQL; PH/General Santos row, local fallback, secret-gated IP, both admin endpoints/alias, anonymous and tenant rejection, no admin self-logging, 30-day cleanup. Synthetic recent rows retained.");
} finally {
  await new Promise((resolve) => server.close(resolve));
  redis.disconnect();
  await prisma.$disconnect();
}
