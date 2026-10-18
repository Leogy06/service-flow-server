// Short-lived subprocesses: production clients cannot keep the runner alive indefinitely.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assertLocalServices } from "./predeploy-utils.mjs";

const backend = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
require("dotenv").config({ path: resolve(backend, ".env"), quiet: true });
const mode = process.argv[2];

async function probe() {
  if (mode === "frontend-environment") {
    const frontend = resolve(backend, "../frontend");
    const frontendRequire = createRequire(resolve(frontend, "package.json"));
    // Match Next's production .env precedence in this isolated process.
    frontendRequire("@next/env").loadEnvConfig(frontend, false, { info() {}, error() {} });
    const api = process.env.NEXT_PUBLIC_API_URL;
    const problems = [];
    let validApi = api === "/api";
    try {
      const url = new URL(api);
      validApi ||= url.protocol === "https:" && !url.username && !url.password;
    } catch { /* Relative /api is valid; other non-URLs are not. */ }
    if (!validApi) problems.push("Set NEXT_PUBLIC_API_URL=/api for the planned same-origin proxy, or an explicit HTTPS API URL before building.");
    let validSite = false;
    try {
      const site = new URL(process.env.SITE_URL);
      validSite = site.protocol === "https:" && !site.username && !site.password && site.pathname === "/" && !site.search && !site.hash;
    } catch { /* Report a missing/malformed origin without printing its value. */ }
    if (!validSite) problems.push("Set SITE_URL to the public HTTPS website origin for canonical links and sharing metadata.");
    assert.equal(problems.length, 0, problems.join("\n"));
    return;
  }
  if (mode === "environment") {
    const { env } = await import("../dist/config/env.js");
    const problems = [];
    let validOrigin = false;
    try {
      const origin = new URL(env.CORS_ORIGIN);
      validOrigin = origin.protocol === "https:" && origin.origin === env.CORS_ORIGIN;
    } catch { /* Report malformed configuration without printing its value. */ }
    if (!validOrigin) problems.push("Production CORS_ORIGIN must be the exact HTTPS website origin without a trailing slash.");
    if (/@resend\.dev\b/i.test(env.EMAIL_FROM)) problems.push("EMAIL_FROM still uses the Resend testing domain. Configure your verified sender before customer email tests.");
    assert.equal(problems.length, 0, problems.join("\n"));
    return;
  }
  assertLocalServices(process.env);
  if (mode === "database") {
    const { prisma } = await import("../dist/lib/prisma.js");
    try {
      const rows = await prisma.$queryRaw`SELECT 1 AS connected`;
      assert.equal(Number(rows[0].connected), 1);
      console.log("Compiled production Prisma client: SELECT 1 passed.");
    } finally { await prisma.$disconnect(); }
  } else if (mode === "redis") {
    const { redis } = await import("../dist/lib/redis.js");
    const { randomUUID } = await import("node:crypto");
    const key = `serviceflow:predeploy:${randomUUID()}`;
    try {
      assert.equal(await redis.ping(), "PONG");
      assert.equal(await redis.set(key, "probe", "EX", 30, "NX"), "OK");
      assert.equal(await redis.get(key), "probe");
      assert.ok(await redis.ttl(key) > 0);
      console.log("Compiled production Redis client: PING/SET/GET/TTL passed.");
    } finally {
      try { if (redis.status === "ready") await redis.del(key); }
      finally { redis.disconnect(); }
    }
  } else {
    throw new Error("Unknown predeploy probe mode.");
  }
}

try { await probe(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
