import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import { env } from "../src/config/env.js";
import { invalidateModuleCache } from "../src/utils/module-cache.js";
import { inspectBrightStarSeed, seedBrightStar } from "./seeds/bright-star.js";
import { BRIGHT_STAR_SLUG, brightStarCustomers, brightStarScenarios } from "./seeds/bright-star-data.js";

try {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => !["--apply", "--dry-run"].includes(flag)) || (flags.includes("--apply") && flags.includes("--dry-run")))
    throw new Error("Usage: npm run seed:bright-star -- dev [--dry-run | --apply]");
  if (env.NODE_ENV === "production") throw new Error("This fictional workflow seed cannot run in production.");
  if (!env.DATABASE_URL) throw new Error("Local seed commands require DATABASE_URL.");
  const target = new URL(env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
    throw new Error("This workflow seed is restricted to a local development database.");
  console.log(`Target: ${target.hostname}:${target.port || 3306}/${decodeURIComponent(target.pathname.slice(1))}; tenant: ${BRIGHT_STAR_SLUG}`);
  const { organization, marker } = await inspectBrightStarSeed(prisma);
  if (!flags.includes("--apply")) {
    console.log(JSON.stringify({ mode: "dry-run", organization: organization.name, alreadySeeded: Boolean(marker),
      planned: { customers: brightStarCustomers.length, requests: brightStarScenarios.length,
        jobs: brightStarScenarios.reduce((sum, scenario) => sum + scenario.jobs.length, 0),
        invoices: brightStarScenarios.filter((scenario) => scenario.invoice).length },
      note: "Existing records, accounts, permissions and subscriptions are preserved. Use --apply to add the sample workflow." }, null, 2));
  } else {
    const result = await seedBrightStar(prisma);
    // Also invalidate on a rerun, so a previous interruption after commit can recover.
    await invalidateModuleCache(["customers", "serviceTypes", "serviceRequests", "jobs", "invoices"], result.organizationId);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error("Bright Star workflow seed failed:", error instanceof Error && !("code" in error)
    ? error.message : "Database operation failed; no partial seed was committed. Check connectivity, migrations and uniqueness conflicts.");
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
