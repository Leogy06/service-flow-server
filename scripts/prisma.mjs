import process from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { parse } from "dotenv";
import { tsImport } from "tsx/esm/api";

const backend = fileURLToPath(new URL("../", import.meta.url));
const presets = {
  generate: ["generate"],
  "migrate-dev": ["migrate", "dev"],
  "migrate-deploy": ["migrate", "deploy"],
  "seed-admin": ["seed", "admin"],
  "seed-roles": ["seed", "roles"],
  "seed-customers": ["seed", "customers"],
  "seed-service-types": ["seed", "service-types"],
  "seed-plans": ["seed", "plans"],
  "seed-catalog": ["seed", "catalog"],
  "seed-bright-star": ["seed", "bright-star"],
};
const seeds = {
  admin: ["prisma/seed.ts", "--admin-only"],
  roles: ["prisma/seed.ts"],
  customers: ["prisma/seed-customers.ts"],
  "service-types": ["prisma/seed-service-types.ts"],
  plans: ["prisma/seed-plans.ts"],
  catalog: ["prisma/seed-catalog.ts"],
  "bright-star": ["prisma/seed-bright-star.ts"],
  development: ["prisma/seed-development.ts"],
  production: ["prisma/seed-production.ts"],
  "development-check": ["tests/prisma/development.mysql.mjs"],
};
const usage = "Usage: npm run prisma:dev -- <Prisma command> [args]\n       npm run prisma:prod -- <Prisma command> [args]\n       npm run seed:prod -- [--dry-run|--apply]\n       npm run seed:catalog -- dev [--dry-run|--apply]\nExamples: migrate status | migrate dev --name change | migrate reset | db seed | seed production --apply | studio";

export function commandPlan(argv) {
  let args = [...argv];
  let prefix = [];
  if (args[0]?.startsWith("--preset=")) {
    prefix = presets[args.shift().slice("--preset=".length)];
    if (!prefix) throw new Error(usage);
  }
  const mode = args.shift();
  if (!["dev", "prod"].includes(mode)) throw new Error(usage);
  args = [...prefix, ...args];
  if (!args.length) throw new Error(usage);
  // An alternate config/schema/URL would bypass the displayed database selection.
  const overrides = ["--url", "--from-url", "--to-url", "--shadow-database-url", "--config", "--schema", "-c", "-s"];
  if (args.some((arg) => overrides.some((flag) => arg === flag || arg.startsWith(`${flag}=`) || (flag.length === 2 && arg.startsWith(flag))))) {
    throw new Error("Connection/config/schema overrides are disabled. Set DATABASE_URL in the selected environment instead.");
  }
  const help = args.includes("--help") || args.includes("-h");
  const command = args.slice(0, 2).join(" ");
  if (mode === "prod" && !help) {
    const allowed = ["migrate deploy", "migrate status", "migrate diff", "migrate resolve", "db pull", "seed production"];
    if (!["generate", "validate", "format", "version", "--version", "-v", "studio"].includes(args[0]) && !allowed.includes(command)) {
      throw new Error("Production permits generate/validate/format/version, studio, migrate deploy/status/diff/resolve, db pull, and seed production. Catalog plans, reset, migrate dev, db push/execute and tenant/sample seeds are blocked. Use seed:prod for system-admin and permissions only.");
    }
  }
  let childArgs = [resolve(backend, "node_modules/prisma/build/index.js"), ...args];
  if (args[0] === "seed") {
    const seed = seeds[args[1]];
    if (!seed) throw new Error("Unknown seed. Available: " + Object.keys(seeds).join(", "));
    childArgs = ["--import", "tsx", ...seed, ...args.slice(2)];
  }
  return {
    mode, childArgs,
    seed: args[0] === "seed" || command === "db seed",
    studio: args[0] === "studio" && !help,
    confirmation: mode === "prod" && !help && (args[0] === "studio" || command === "migrate deploy" || command === "migrate resolve" || (command === "seed production" && args.includes("--apply"))),
  };
}

export function selectEnvironment(mode, file, injected) {
  if (!["dev", "prod"].includes(mode)) throw new Error(usage);
  // Explicit dev selection must not inherit a production database from the shell.
  if (mode === "dev" && !file.DATABASE_URL) throw new Error(".env.development must define DATABASE_URL.");
  const inherited = { ...injected };
  if (mode === "dev") {
    delete inherited.DATABASE_URL;
    delete inherited.REDIS_URL;
  }
  return {
    ...(mode === "prod" ? { ...file, ...inherited } : { ...inherited, ...file }),
    NODE_ENV: mode === "prod" ? "production" : "development",
  };
}

export function targetSummary(mode, environment, fileName) {
  const url = new URL(environment.DATABASE_URL);
  if (mode === "dev" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Development commands require your local MySQL database. Check .env.development.");
  }
  return { environment: environment.NODE_ENV, file: fileName, host: url.hostname, port: url.port || "3306", database: decodeURIComponent(url.pathname.slice(1)) };
}

export async function confirmProduction({ input = process.stdin, output = process.stdout } = {}) {
  const reader = createInterface({ input, output });
  const controller = new AbortController();
  reader.once("close", () => controller.abort());
  try {
    return await reader.question("Type production to continue with production access: ", { signal: controller.signal }) === "production";
  } catch {
    return false;
  } finally {
    reader.close();
  }
}

// Keep the production gate ahead of subprocess execution, including seeds.
export async function executePlan(plan, environment, { confirm = confirmProduction, execute = spawnSync } = {}) {
  if (plan.confirmation && !await confirm()) throw new Error("Production changes cancelled.");
  let childEnvironment = plan.seed ? { ...environment, LOG_LEVEL: "error" } : environment;
  if (plan.studio && new URL(environment.DATABASE_URL).searchParams.has("sslcert")) {
    const { prismaDatasourceUrl } = await tsImport("../src/config/database.ts", import.meta.url);
    const certificate = new URL(prismaDatasourceUrl(environment.DATABASE_URL)).searchParams.get("sslcert");
    try {
      readFileSync(certificate);
    } catch {
      throw new Error("DATABASE_URL sslcert file could not be read (paths are relative to backend/prisma)");
    }
    // Studio ignores sslcert. Node must load the selected CA before the child starts.
    childEnvironment = { ...childEnvironment, NODE_EXTRA_CA_CERTS: certificate };
  }
  const result = execute(process.execPath, plan.childArgs, { cwd: backend, env: childEnvironment, stdio: "inherit" });
  if (result.error) throw new Error("Could not start Prisma/seed. Install backend development dependencies first.");
  return result.status ?? 1;
}

async function main() {
  if (["--help", "-h"].includes(process.argv[2])) {
    console.log(usage);
    return;
  }
  const plan = commandPlan(process.argv.slice(2));
  const fileName = `.env.${plan.mode === "prod" ? "production" : "development"}`;
  let file;
  try {
    file = parse(readFileSync(resolve(backend, fileName)));
  } catch {
    throw new Error(`Could not read backend/${fileName}. Configure it before running Prisma.`);
  }
  const environment = selectEnvironment(plan.mode, file, process.env);
  const { databaseEnvironmentSchema } = await tsImport("../src/config/database.ts", import.meta.url);
  const parsed = databaseEnvironmentSchema.safeParse(environment);
  if (!parsed.success) throw new Error("Invalid database environment:\n" + parsed.error.issues.map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n"));
  console.log("Prisma target: " + JSON.stringify(targetSummary(plan.mode, parsed.data, fileName)));
  process.exitCode = await executePlan(plan, environment);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
