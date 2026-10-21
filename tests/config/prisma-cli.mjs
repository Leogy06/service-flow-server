import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { URL } from "node:url";
import { commandPlan, selectEnvironment, targetSummary, executePlan, confirmProduction } from "../../scripts/prisma.mjs";

const local = "mysql://local:private-sample@127.0.0.1:3306/development_db";
const remote = "mysql://remote:private-sample@database.example.com:3306/production_db?sslaccept=strict";

test("all entrypoints require explicit mode and retain command arguments", () => {
  assert.throws(() => commandPlan(["migrate", "dev"]), /Usage:/);
  assert.throws(() => commandPlan(["--preset=seed-catalog", "--apply"]), /Usage:/);
  assert.throws(() => commandPlan(["dev"]), /Usage:/);
  const plan = commandPlan(["dev", "migrate", "dev", "--name", "new-job-field"]);
  assert.deepEqual(plan.childArgs.slice(1), ["migrate", "dev", "--name", "new-job-field"]);
  assert.deepEqual(commandPlan(["--preset=migrate-dev", "dev"]).childArgs.slice(1), ["migrate", "dev"]);
});

test("dev selection replaces inherited production DB/Redis; prod retains injected values", () => {
  const file = { DATABASE_URL: local, REDIS_URL: "redis://localhost:6379", NODE_ENV: "production" };
  const injected = { DATABASE_URL: remote, REDIS_URL: "rediss://sample@remote.example.com:6379" };
  assert.deepEqual(selectEnvironment("dev", file, injected), { ...file, NODE_ENV: "development" });
  assert.deepEqual(selectEnvironment("prod", file, injected), { ...file, ...injected, NODE_ENV: "production" });
  assert.throws(() => selectEnvironment("dev", {}, injected), /must define DATABASE_URL/);
});

test("target display contains host/database, omits credentials and refuses remote dev targets", () => {
  const display = targetSummary("dev", { DATABASE_URL: local, NODE_ENV: "development" }, ".env.development");
  assert.equal(display.database, "development_db");
  assert.equal(display.host, "127.0.0.1");
  assert.doesNotMatch(JSON.stringify(display), /private-sample|mysql:\/\//);
  assert.throws(() => targetSummary("dev", { DATABASE_URL: remote }, ".env.development"), /local MySQL/);
});

test("a missing dev Redis setting cannot inherit a production cache URL", () => {
  const environment = selectEnvironment("dev", { DATABASE_URL: local }, { REDIS_URL: "rediss://sample:private@prod.example.com:6379" });
  assert.equal(environment.REDIS_URL, undefined);
});

test("production rejects destructive commands, tenant seeds and connection overrides", () => {
  for (const args of [["migrate", "reset"], ["migrate", "dev"], ["db", "push"], ["db", "execute"], ["db", "seed"], ["seed", "roles"], ["seed", "bright-star"], ["seed", "development"], ["seed", "catalog"], ["seed", "plans"]]) {
    assert.throws(() => commandPlan(["prod", ...args]), /Production permits/);
  }
  for (const args of [["--url", remote], ["--url=" + remote], ["--config=other.ts"], ["--schema", "other.prisma"], ["-sother.prisma"], ["--from-url", remote]]) {
    assert.throws(() => commandPlan(["dev", "migrate", "status", ...args]), /overrides are disabled/);
  }
});

test("read commands/generation need no production confirmation; write commands always do", () => {
  for (const args of [["migrate", "status"], ["migrate", "diff"], ["generate"], ["validate"], ["db", "pull"], ["seed", "production", "--dry-run"]]) {
    assert.equal(commandPlan(["prod", ...args]).confirmation, false);
  }
  assert.equal(commandPlan(["prod", "migrate", "deploy"]).confirmation, true);
  for (const flag of ["--applied", "--rolled-back"]) {
    const plan = commandPlan(["prod", "migrate", "resolve", flag, "20260908120316_fix_userpermission_pk"]);
    assert.equal(plan.confirmation, true);
    assert.deepEqual(plan.childArgs.slice(1), ["migrate", "resolve", flag, "20260908120316_fix_userpermission_pk"]);
  }
  assert.equal(commandPlan(["prod", "migrate", "resolve", "--help"]).confirmation, false);
  assert.equal(commandPlan(["prod", "seed", "production", "--apply"]).confirmation, true);
  assert.equal(commandPlan(["prod", "studio", "--port", "5555"]).confirmation, true);
  assert.equal(commandPlan(["prod", "studio", "--help"]).confirmation, false);
  assert.equal(commandPlan(["dev", "migrate", "reset"]).confirmation, false);
});

test("seed shortcuts use the exact existing seed file and preserve flags", () => {
  const plan = commandPlan(["prod", "seed", "production", "--apply"]);
  assert.deepEqual(plan.childArgs, ["--import", "tsx", "prisma/seed-production.ts", "--apply"]);
  assert.equal(plan.confirmation, true);
  assert.deepEqual(commandPlan(["--preset=seed-catalog", "dev", "--apply"]).childArgs,
    ["--import", "tsx", "prisma/seed-catalog.ts", "--apply"]);
  assert.deepEqual(commandPlan(["dev", "db", "seed"]).childArgs.slice(1), ["db", "seed"]);
  assert.deepEqual(commandPlan(["dev", "seed", "development", "--apply"]).childArgs,
    ["--import", "tsx", "prisma/seed-development.ts", "--apply"]);
  assert.throws(() => commandPlan(["dev", "seed", "unknown"]), /Unknown seed/);
});

test("cancelled production confirmation never launches Prisma, Studio or a seed", async () => {
  for (const args of [["migrate", "deploy"], ["migrate", "resolve", "--applied", "20260908120316_fix_userpermission_pk"], ["migrate", "resolve", "--rolled-back", "20260908120316_fix_userpermission_pk"], ["studio"], ["seed", "production", "--apply"]]) {
    let executed = false;
    await assert.rejects(executePlan(commandPlan(["prod", ...args]), {}, {
      confirm: async () => false,
      execute: () => { executed = true; return { status: 0 }; },
    }), /cancelled/);
    assert.equal(executed, false);
  }
});

test("confirmed operations forward the selected environment and return the child status", async () => {
  const environment = selectEnvironment("prod", { DATABASE_URL: local }, { DATABASE_URL: remote });
  const plan = commandPlan(["prod", "migrate", "deploy"]);
  let calls = 0;
  assert.equal(await executePlan(plan, environment, {
    confirm: async () => true,
    execute: (_node, args, options) => {
      calls++;
      assert.deepEqual(args, plan.childArgs);
      assert.equal(options.env.DATABASE_URL, remote);
      assert.equal(options.env.NODE_ENV, "production");
      return { status: 2 };
    },
  }), 2);
  assert.equal(calls, 1);
});

test("the real production prompt accepts only production and cancels safely on EOF", async () => {
  for (const [answer, expected] of [["production\n", true], ["yes\n", false], ["", false]]) {
    const input = new PassThrough();
    const output = new PassThrough();
    const confirmation = confirmProduction({ input, output });
    input.end(answer);
    assert.equal(await confirmation, expected);
  }
});

test("Studio trusts the selected CA at child startup without changing the URL or parent environment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "studio-ca-"));
  const certificate = join(directory, "provider ca.pem");
  writeFileSync(certificate, "sample test CA");
  try {
    const url = new URL(remote);
    url.searchParams.set("sslcert", relative(resolve("prisma"), certificate));
    const environment = { NODE_ENV: "production", DATABASE_URL: url.toString(), NODE_EXTRA_CA_CERTS: "other-ca.pem" };
    let calls = 0;
    await executePlan(commandPlan(["prod", "studio"]), environment, {
      confirm: async () => true,
      execute: (_node, _args, options) => {
        calls++;
        assert.equal(resolve(options.env.NODE_EXTRA_CA_CERTS), certificate);
        assert.equal(options.env.DATABASE_URL, environment.DATABASE_URL);
        return { status: 0 };
      },
    });
    assert.equal(calls, 1);
    assert.equal(environment.NODE_EXTRA_CA_CERTS, "other-ca.pem");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Studio refuses an unreadable CA before launching, while other commands and system-trust Studio keep their environment", async () => {
  let executed = false;
  await assert.rejects(executePlan(commandPlan(["prod", "studio"]), {
    DATABASE_URL: remote + "&sslcert=missing-ca-directory/no-ca.pem",
  }, {
    confirm: async () => true,
    execute: () => { executed = true; return { status: 0 }; },
  }), /sslcert file could not be read/);
  assert.equal(executed, false);
  for (const args of [["studio"], ["studio", "--help"], ["migrate", "status"]]) {
    const environment = { DATABASE_URL: remote, NODE_EXTRA_CA_CERTS: "existing-ca.pem" };
    await executePlan(commandPlan(["prod", ...args]), environment, {
      confirm: async () => true,
      execute: (_node, _args, options) => {
        assert.equal(options.env, environment);
        return { status: 0 };
      },
    });
  }
});
