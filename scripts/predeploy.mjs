// Run via npm run test:predeploy. Does not install/prune packages, seed, send email,
// or migrate/reset the configured database. Only a newly created Docker DB is migrated.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { assertLocalServices, createRedactor, freePort, reportResult, resultExitCode } from "./predeploy-utils.mjs";

const backend = fileURLToPath(new URL("../", import.meta.url));
const frontend = resolve(backend, "../frontend");
const require = createRequire(new URL("../package.json", import.meta.url));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: npm run test:predeploy [-- --skip-linux]\nRequires installed backend/frontend dependencies, local MySQL/Redis and Docker Desktop.\n--skip-linux records the migration replay as BLOCKED (never a full pass).\nReports: backend/.predeploy/<run>/REPORT.md and results.json. See scripts/PREDEPLOY.md.");
  process.exit(0);
}
if (args.some((arg) => arg !== "--skip-linux")) {
  console.error("Unknown option. Use --help.");
  process.exit(1);
}
const originalEnv = { ...process.env };
const fileEnv = require("dotenv").parse(existsSync(join(backend, ".env")) ? readFileSync(join(backend, ".env")) : "");
const backendEnv = { ...fileEnv, ...originalEnv };
const runtimeEnv = { ...backendEnv, NODE_ENV: "production", LOG_LEVEL: backendEnv.LOG_LEVEL ?? "info" };
const secrets = createRedactor(backendEnv);
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
const directory = join(backend, ".predeploy", runId);
mkdirSync(directory, { recursive: true });
const results = [];
const children = new Set();
const retained = [];
const npmCli = process.env.npm_execpath;
let interrupted = false;
let completed = false;

function report() {
  const code = resultExitCode(results);
  const lines = ["# Local predeployment checks", "", `Run: ${runId}`, "",
    `Result: ${reportResult(results, completed)}`, "",
    "| Check | Result | Details |", "| --- | --- | --- |",
    ...results.map(({ name, status, detail }) => `| ${name} | ${status} | ${secrets.redact(detail).replace(/[\r\n|]/g, " ")} |`),
    "", "These checks do not certify public HTTPS, DNS, email delivery, browser business workflows,",
    "backup restoration, tenant isolation beyond existing unit coverage, or capacity on a 2 GB VPS.",
    "Existing browser/database fixture suites are not run against your application database.",
    "Docker application images and proxy integration are not built/tested by this runner.",
    "Runtime probes use production mode and default LOG_LEVEL=info if absent; the separate environment check does not supply this default.",
    "The frontend build uses your actual production environment; this script does not rewrite .env files.",
    "No configured database migrations, seeds, resets, or email sends are performed.",
    "Redis probes use an expiring diagnostic key; the API smoke check also exercises local rate-limit counters.",
    "", "## Retained isolated resources", "", ...(retained.length ? retained : ["None."]), ""];
  writeFileSync(join(directory, "REPORT.md"), lines.join("\n"));
  writeFileSync(join(directory, "results.json"), JSON.stringify({ runId, completed, exitCode: completed ? (interrupted ? 130 : code) : null, results, retained }, null, 2));
}
function record(name, status, detail) {
  results.push({ name, status, detail: secrets.redact(detail) });
  console.log(`[${status}] ${name}: ${secrets.redact(detail)}`);
  report();
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((done) => child.once("close", done));
  if (process.platform === "win32" && child.pid) {
    // npm starts its own children on Windows; terminate only this run's process tree.
    await new Promise((done) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.once("error", done);
      killer.once("close", done);
    });
  }
  child.kill("SIGTERM");
  await Promise.race([closed, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([closed, delay(3000)]);
  }
}
// Spawn programs directly (no shell). Capture and redact whole lines so secrets
// split across stdout chunks never reach the console or persisted reports.
function launch(executable, commandArgs, { cwd = backend, env = backendEnv, logName = "process" } = {}) {
  const logPath = join(directory, `${logName}.log`);
  let tail = "";
  const child = spawn(executable, commandArgs, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const buffers = new Map();
  for (const stream of [child.stdout, child.stderr]) {
    buffers.set(stream, "");
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = (buffers.get(stream) + chunk).split(/\r?\n/);
      buffers.set(stream, lines.pop());
      for (const line of lines) save(line + "\n");
    });
  }
  function save(value) {
    const safe = secrets.redact(value);
    appendFileSync(logPath, safe);
    tail = (tail + safe).slice(-4000);
  }
  const done = new Promise((finish) => {
    let error;
    child.on("error", (failure) => { error = failure.code; });
    child.on("close", (code, signal) => {
      for (const value of buffers.values()) if (value) save(value);
      children.delete(child);
      finish({ code: error ? 1 : code ?? 1, signal, error, tail, log: `${logName}.log` });
    });
  });
  return { child, done, output: () => tail };
}
async function command(name, executable, commandArgs, options = {}) {
  if (interrupted && !options.cleanup) throw new Error("Interrupted");
  console.log(`Running ${name}...`);
  const processHandle = launch(executable, commandArgs, { logName: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), ...options });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; void stop(processHandle.child); }, options.timeout ?? 600000);
  const result = await processHandle.done;
  clearTimeout(timeout);
  const status = result.code === 0 && !expired ? "PASS" : "FAIL";
  record(name, status, expired ? `Timed out. See ${result.log}` : `${result.error ?? `exit ${result.code}`}; see ${result.log}`);
  if (status === "FAIL") console.log(result.tail.slice(-2000));
  return status === "PASS";
}
async function npm(name, cwd, script, extra = [], env = backendEnv) {
  if (!npmCli || !existsSync(npmCli)) {
    record(name, "BLOCKED", "Run this script through npm run test:predeploy so the npm CLI can be located.");
    return false;
  }
  return command(name, process.execPath, [npmCli, "run", script, ...(extra.length ? ["--", ...extra] : [])], { cwd, env });
}
async function smoke(name, entry, cwd, paths, env) {
  const port = await freePort();
  const isFrontend = cwd === frontend;
  const handle = launch(process.execPath,
    isFrontend ? [entry, "start", "--hostname", "127.0.0.1", "--port", String(port)] : [entry],
    { cwd, env: { ...env, PORT: String(port), HOSTNAME: "127.0.0.1" }, logName: isFrontend ? "frontend-startup" : "backend-startup" });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (interrupted) throw new Error("Interrupted");
      if (handle.child.exitCode !== null || handle.child.signalCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}${paths[0][0]}`, { signal: AbortSignal.timeout(500) });
        ready = response.status === paths[0][1];
      } catch { /* Server is still starting; deadline is bounded. */ }
      if (ready) break;
      await delay(200);
    }
    if (!ready) throw new Error(`Server did not become ready. ${handle.output()}`);
    for (const [path, status] of paths) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(5000) });
      if (response.status !== status) throw new Error(`${path}: expected ${status}, received ${response.status}`);
      if (isFrontend && !response.headers.get("content-type")?.includes("text/html")) throw new Error(`${path}: expected HTML`);
      if (!isFrontend && path === "/api/health" && (await response.json()).status !== "ok") throw new Error("Unexpected health payload");
      if (!response.bodyUsed) await response.body?.cancel();
    }
    record(name, "PASS", paths.map(([path, status]) => `${path} ${status}`).join(", "));
  } catch (error) { record(name, "FAIL", error.message); }
  finally { await stop(handle.child); }
}
async function linuxMigrations() {
  if (args.includes("--skip-linux")) {
    record("Linux MySQL migration replay", "BLOCKED", "Explicitly skipped with --skip-linux.");
    return;
  }
  const docker = launch("docker", ["info", "--format", "{{.OSType}}"], { logName: "docker-info" });
  const deadline = setTimeout(() => { void stop(docker.child); }, 15000);
  const info = await docker.done;
  clearTimeout(deadline);
  if (info.code !== 0 || info.tail.trim() !== "linux") {
    record("Linux MySQL migration replay", "BLOCKED", "Start Docker Desktop with Linux containers. See docker-info.log.");
    return;
  }
  if (!await command("MySQL Linux image", "docker", ["pull", "mysql:8.4"])) {
    record("Linux MySQL migration replay", "BLOCKED", "MySQL image unavailable.");
    return;
  }
  const suffix = randomBytes(6).toString("hex");
  const container = `serviceflow-predeploy-${suffix}`;
  const database = `service_flow_platform_test_deploy_${suffix}`;
  const password = randomBytes(24).toString("hex");
  secrets.add(password);
  const port = await freePort();
  const env = { ...runtimeEnv, MYSQL_ROOT_PASSWORD: password, MYSQL_ROOT_HOST: "%", MYSQL_DATABASE: database,
    DATABASE_HOST: "127.0.0.1", DATABASE_PORT: String(port), DATABASE_USER: "root", DATABASE_PASSWORD: password,
    DATABASE_NAME: database, DATABASE_URL: `mysql://root:${password}@127.0.0.1:${port}/${database}` };
  // Never target an existing container, database, or volume; never issue rm/drop/reset.
  const started = await command("Create isolated Linux MySQL", "docker", ["run", "-d", "--name", container,
    "--label", "serviceflow.purpose=predeploy-test", "--memory", "1g", "-p", `127.0.0.1:${port}:3306`,
    "-e", "MYSQL_ROOT_PASSWORD", "-e", "MYSQL_ROOT_HOST", "-e", "MYSQL_DATABASE", "mysql:8.4", "--lower-case-table-names=1"], { env, timeout: 60000 });
  if (!started) {
    record("Linux MySQL migration replay", "BLOCKED", "Isolated MySQL container could not be created.");
    return;
  }
  retained.push(`Container ${container}; database ${database}. Retained after stopping; no volumes are removed.`);
  report();
  let connection;
  try {
    const mariadb = require("mariadb");
    for (let attempt = 0; attempt < 120; attempt++) {
      if (interrupted) throw new Error("Interrupted");
      try {
        connection = await mariadb.createConnection({ host: "127.0.0.1", port, user: "root", password, database,
          allowPublicKeyRetrieval: true, connectTimeout: 1000 });
        break;
      } catch { await delay(1000); }
    }
    if (!connection) throw new Error("Isolated Linux MySQL was not ready within the deadline.");
    const [row] = await connection.query("SELECT @@lower_case_table_names AS casing");
    if (Number(row.casing) !== 1) throw new Error("New Linux MySQL must use lower_case_table_names=1.");
    await connection.end(); connection = undefined;
    const migrated = await command("Linux MySQL migration replay", process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, timeout: 180000 });
    if (migrated) await command("Compiled Prisma against Linux MySQL", process.execPath,
      ["scripts/predeploy-probe.mjs", "database"], { env, timeout: 20000 });
    else record("Compiled Prisma against Linux MySQL", "BLOCKED", "Fresh migration replay failed.");
  } catch (error) { record("Linux MySQL readiness", "FAIL", error.message); }
  finally {
    if (connection) await connection.end();
    // Stop only the uniquely named container created in this run. Retain its data.
    await command("Stop isolated Linux MySQL", "docker", ["stop", container], { timeout: 60000, cleanup: true });
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interrupted = true;
  for (const child of children) void stop(child);
});

console.log(`Local predeployment report: ${join(directory, "REPORT.md")}`);
try {
  await command("Runner safety tests", process.execPath, ["--test", "scripts/predeploy-safety.mjs"]);
  const generated = await npm("Prisma generation", backend, "generate");
  await npm("Backend lint", backend, "lint");
  await command("Backend TypeScript", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
  await npm("Backend unit tests", backend, "test", ["--runInBand"], { ...backendEnv, NODE_ENV: "test" });
  const apiBuild = await npm("Backend production build", backend, "build");
  await npm("Frontend lint", frontend, "lint", [], originalEnv);
  const webBuild = await npm("Frontend production build", frontend, "build", [],
    { ...originalEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" });
  // Next build generates route types; run tsc after it to avoid stale .next types.
  await command("Frontend TypeScript", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"], { cwd: frontend, env: originalEnv });
  for (const script of ["test:permissions", "test:roles", "test:system-admin", "test:theme", "test:website:metadata"]) {
    await npm(`Frontend ${script}`, frontend, script, [], originalEnv);
  }
  await command("Frontend production environment", process.execPath, ["scripts/predeploy-probe.mjs", "frontend-environment"],
    { env: { ...originalEnv, NODE_ENV: "production" }, timeout: 20000 });
  if (!generated || !apiBuild) {
    record("Backend runtime probes", "BLOCKED", "Prisma generation or backend build failed; old dist is not tested.");
  } else {
    await command("Backend production environment", process.execPath, ["scripts/predeploy-probe.mjs", "environment"],
      { env: { ...backendEnv, NODE_ENV: "production" }, timeout: 20000 });
    try {
      assertLocalServices(backendEnv);
      await command("Configured MySQL connectivity", process.execPath, ["scripts/predeploy-probe.mjs", "database"], { env: runtimeEnv, timeout: 20000 });
      await command("Configured database migration status (read only)", process.execPath,
        ["node_modules/prisma/build/index.js", "migrate", "status"], { env: backendEnv, timeout: 30000 });
      await command("Configured Redis connectivity", process.execPath, ["scripts/predeploy-probe.mjs", "redis"], { env: runtimeEnv, timeout: 20000 });
      await smoke("Compiled backend startup", "dist/index.js", backend, [["/api/health", 200], ["/api/auth/me", 401]], runtimeEnv);
    } catch (error) { record("Local service safety gate", "BLOCKED", error.message); }
    await linuxMigrations();
  }
  if (webBuild) await smoke("Optimized frontend startup", join(frontend, "node_modules/next/dist/bin/next"), frontend,
    [["/login", 200], ["/", 200], ["/signup", 200], ["/terms", 200], ["/privacy", 200]],
    { ...originalEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" });
  else record("Optimized frontend startup", "BLOCKED", "Frontend build failed; old .next is not tested.");
  const missing = ["Dockerfile", ".dockerignore"].flatMap((file) =>
    [backend, frontend].filter((dir) => !existsSync(join(dir, file)) || !readFileSync(join(dir, file), "utf8").trim())
      .map((dir) => `${dir === backend ? "backend" : "frontend"}/${file}`));
  record("Docker application deployment", "BLOCKED", missing.length ? `Missing or empty: ${missing.join(", ")}. Application containers/proxy not tested.` :
    "Dockerfiles present. Full Compose application build/start and proxy integration still require verification.");
  record("External and browser acceptance", "BLOCKED", "HTTPS cookies, real email delivery, browser workflows, backup restore and VPS load need separate acceptance tests.");
} catch (error) { record("Runner", "FAIL", error.message); }
finally {
  for (const child of children) await stop(child);
  completed = true;
  report();
  console.table(results.map(({ name, status }) => ({ check: name, result: status })));
  console.log(`Report: ${join(directory, "REPORT.md")}`);
  process.exitCode = interrupted ? 130 : resultExitCode(results);
}
