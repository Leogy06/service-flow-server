import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const backend = fileURLToPath(new URL("../../", import.meta.url));

test("Vercel's selected app loads in plain Node ESM without a TypeScript loader", () => {
  // Run after prod:build. Express searches outputDirectory before source files.
  const config = JSON.parse(readFileSync(resolve(backend, "vercel.json"), "utf8"));
  const entrypoint = pathToFileURL(resolve(backend, config.outputDirectory ?? "src", "app.js")).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
    cwd: backend,
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
    env: {
      ...Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"]
        .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])),
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      DATABASE_URL: "mysql://smoke:smoke@database.invalid:3306/smoke?sslaccept=strict",
      REDIS_URL: "rediss://default:smoke@redis.invalid:6379",
      CORS_ORIGIN: "https://frontend.example.com",
      JWT_ACCESS_SECRET: "smoke-access-secret",
      JWT_REFRESH_SECRET: "smoke-refresh-secret",
      RESEND_API_KEY: "re_smoke",
      EMAIL_FROM: "Smoke <smoke@example.com>",
    },
    input: `
      import assert from 'node:assert/strict';
      import { registerHooks } from 'node:module';
      import { Socket } from 'node:net';
      // Never read private env files or contact MySQL, Redis or email services.
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier === 'dotenv') return {
          url: 'data:text/javascript,export const config = () => ({});', shortCircuit: true,
        };
        return nextResolve(specifier, context);
      } });
      Socket.prototype.connect = () => { throw new Error('Unexpected network connection during startup'); };
      globalThis.prisma = {};
      globalThis.serviceFlowRedis = { status: 'end' };
      const { default: app } = await import(${JSON.stringify(entrypoint)});
      assert.equal(typeof app, 'function');
      assert.equal(typeof app.handle, 'function');
      assert.equal(typeof app.listen, 'function');
      assert.equal(app.get('trust proxy'), 0);
      console.log('Compiled Express app loaded successfully');
    `,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Compiled Express app loaded successfully/);
});
