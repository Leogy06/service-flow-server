import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough } from "node:stream";
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
  for (const args of [["migrate", "reset"], ["migrate", "dev"], ["db", "push"], ["db", "execute"], ["db", "seed"], ["studio"], ["seed", "roles"], ["seed", "bright-star"]]) {
    assert.throws(() => commandPlan(["prod", ...args]), /Production permits/);
  }
  for (const args of [["--url", remote], ["--url=" + remote], ["--config=other.ts"], ["--schema", "other.prisma"], ["-sother.prisma"], ["--from-url", remote]]) {
    assert.throws(() => commandPlan(["dev", "migrate", "status", ...args]), /overrides are disabled/);
  }
});

test("read commands/generation need no production confirmation; write commands always do", () => {
  for (const args of [["migrate", "status"], ["migrate", "diff"], ["generate"], ["validate"], ["db", "pull"], ["seed", "catalog", "--dry-run"]]) {
    assert.equal(commandPlan(["prod", ...args]).confirmation, false);
  }
  assert.equal(commandPlan(["prod", "migrate", "deploy"]).confirmation, true);
  assert.equal(commandPlan(["prod", "seed", "catalog", "--apply"]).confirmation, true);
  assert.equal(commandPlan(["dev", "migrate", "reset"]).confirmation, false);
});

test("seed shortcuts use the exact existing seed file and preserve flags", () => {
  const plan = commandPlan(["--preset=seed-catalog", "prod", "--apply"]);
  assert.deepEqual(plan.childArgs, ["--import", "tsx", "prisma/seed-catalog.ts", "--apply"]);
  assert.equal(plan.confirmation, true);
  assert.deepEqual(commandPlan(["dev", "db", "seed"]).childArgs.slice(1), ["db", "seed"]);
  assert.throws(() => commandPlan(["dev", "seed", "unknown"]), /Unknown seed/);
});

test("cancelled production confirmation never launches Prisma or a seed", async () => {
  for (const args of [["migrate", "deploy"], ["seed", "catalog", "--apply"]]) {
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
