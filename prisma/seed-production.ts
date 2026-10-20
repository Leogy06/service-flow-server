import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import { invalidateModuleCache } from "../src/utils/module-cache.js";
import { seedProduction } from "./seeds/production.js";

try {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => !["--dry-run", "--apply"].includes(flag)) || (flags.includes("--dry-run") && flags.includes("--apply"))) {
    throw new Error("Usage: npm run seed:prod -- [--dry-run | --apply]");
  }
  const result = await seedProduction(prisma, env, !flags.includes("--apply"));
  if (!result.dryRun) await invalidateModuleCache("platformDashboard");
  console.log(JSON.stringify(result, null, 2));
  console.log(result.dryRun ? "Preview complete. Use --apply to provision permissions and the system administrator."
    : "Production setup complete: permissions and system administrator only; existing credentials and grants preserved.");
} catch (error) {
  console.error("Production seed failed:", error instanceof Error && !("code" in error) && error.name === "Error"
    ? error.message : "Database operation failed. No partial seed committed; check connectivity, migrations and ownership conflicts.");
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
