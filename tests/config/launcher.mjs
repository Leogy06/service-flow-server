import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";

const backend = fileURLToPath(new URL("../../", import.meta.url));
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";

function run(mode, { input = "", extraEnv = {}, dependencies = true, missingFile = false } = {}) {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, "service-flow-launcher-"));
  assert.equal(dirname(directory), root);
  assert.ok(basename(directory).startsWith("service-flow-launcher-"));
  try {
    const project = join(directory, "backend");
    mkdirSync(join(project, "scripts"), { recursive: true });
    mkdirSync(join(directory, "bin"));
    copyFileSync(join(backend, "scripts/run.sh"), join(project, "scripts/run.sh"));
    if (dependencies) {
      for (const dependency of ["tsx", "prisma", "typescript"]) {
        mkdirSync(join(project, "node_modules", dependency), { recursive: true });
        writeFileSync(join(project, "node_modules", dependency, "package.json"), "{}");
      }
    }
    if (!missingFile) {
      writeFileSync(join(project, ".env.development"), "NODE_ENV='production'\nJWT_ACCESS_SECRET='file-only-sample'\n");
      writeFileSync(join(project, ".env.production"), "NODE_ENV='development'\nJWT_ACCESS_SECRET='file-only-sample'\n");
    }
    const trace = join(directory, "trace").replaceAll("\\", "/");
    const commands = {
      node: `#!/usr/bin/env bash
set -euo pipefail
printf 'node:%s:%s\\n' "$NODE_ENV" "$JWT_ACCESS_SECRET" >> "$TRACE"
if [[ "$1" == node_modules/prisma/build/index.js ]]; then printf 'prisma:%s:%s\\n' "$NODE_ENV" "\${*:2}" >> "$TRACE"; fi
`,
      npm: `#!/usr/bin/env bash
set -euo pipefail
printf 'npm:%s:%s\\n' "$NODE_ENV" "$*" >> "$TRACE"
`,
      docker: `#!/usr/bin/env bash
set -euo pipefail
printf 'docker:%s:%s\\n' "$NODE_ENV" "$*" >> "$TRACE"
if [[ "$*" == info && "\${DOCKER_STOPPED:-0}" == 1 ]]; then exit 1; fi
if [[ "$*" == 'container inspect '* && "\${REDIS_EXISTS:-0}" == 0 ]]; then exit 1; fi
if [[ "$*" == inspect* ]]; then echo true; fi
`,
    };
    for (const [name, contents] of Object.entries(commands)) {
      writeFileSync(join(directory, "bin", name), contents, { mode: 0o755 });
    }
    const script = join(project, "scripts/run.sh").replaceAll("\\", "/");
    const bin = join(directory, "bin").replaceAll("\\", "/");
    const driver = `${process.platform === "win32" ? 'MOCK_BIN="$(cygpath -u "$MOCK_BIN")"; ' : ''}export PATH="$MOCK_BIN:$PATH"; exec bash "$RUN_SCRIPT" "$RUN_MODE"`;
    const result = spawnSync(bash, ["-c", driver], {
      cwd: directory, input, encoding: "utf8", windowsHide: true,
      env: { ...process.env, TRACE: trace, MOCK_BIN: bin, RUN_SCRIPT: script, RUN_MODE: mode, ...extraEnv },
    });
    if (result.error) throw result.error;
    return { ...result, trace: existsSync(trace) ? readFileSync(trace, "utf8") : "" };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("dev starts only Docker Redis before generate/migrate/watch from another directory", () => {
  const result = run("dev", { dependencies: false });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.trace, /docker:development:info/);
  assert.match(result.trace, /npm:development:ci --include=dev/);
  assert.match(result.trace, /docker:development:run -d --name serviceflow-dev-redis[\s\S]*redis:7-alpine[\s\S]*docker:development:exec serviceflow-dev-redis redis-cli ping[\s\S]*prisma:development:generate[\s\S]*prisma:development:migrate dev[\s\S]*run dev/);
  assert.doesNotMatch(result.trace, /compose|mysql:|DEV_MYSQL|prisma:deploy|npm:production/);
});

test("dev reuses its existing Redis container", () => {
  const result = run("dev", { extraEnv: { REDIS_EXISTS: "1" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.trace, /docker:development:start serviceflow-dev-redis/);
  assert.doesNotMatch(result.trace, /docker:development:run /);
});

test("dev reports stopped Docker before dependency installation or migrations", () => {
  const result = run("dev", { extraEnv: { DOCKER_STOPPED: "1" }, dependencies: false });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Docker is not running/);
  assert.doesNotMatch(result.trace, /npm:|up -d|prisma/);
});

test("prod preserves injected secrets and only deploys after confirmation, without Docker", () => {
  const result = run("prod", { input: "production\n", extraEnv: { JWT_ACCESS_SECRET: "injected-sample" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.trace, /node:production:injected-sample/);
  assert.match(result.trace, /ci --include=dev[\s\S]*prisma:production:generate[\s\S]*run build[\s\S]*prisma:production:migrate deploy[\s\S]*prune --omit=dev[\s\S]*npm:production:start/);
  assert.doesNotMatch(result.trace, /docker:|migrate dev|reset|db push/);
  assert.doesNotMatch(result.stdout + result.stderr, /injected-sample|file-only-sample/);
});

test("wrong or missing production confirmation never migrates or starts", () => {
  for (const input of ["no\n", ""]) {
    const result = run("prod", { input });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.trace, /migrate deploy|prune|npm:production:start|docker:/);
  }
});

test("missing environment file and invalid arguments fail before running tools", () => {
  const missing = run("dev", { missingFile: true });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing .env.development/);
  assert.equal(missing.trace, "");
  const invalid = run("unknown");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Usage:/);
  assert.equal(invalid.trace, "");
});
