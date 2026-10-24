import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";
import { redis } from "../src/lib/redis.js";
import { invalidateModuleCache } from "../src/utils/module-cache.js";
import { seedCatalog } from "./seeds/catalog.js";

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--apply", "--dry-run"].includes(arg)) ||
      (args.includes("--apply") && args.includes("--dry-run"))) {
    throw new Error("Usage: npm run seed:catalog -- dev [--dry-run | --apply]");
  }
  if (!env.DATABASE_URL) throw new Error("Local seed commands require DATABASE_URL.");
  const target = new URL(env.DATABASE_URL);
  if (env.NODE_ENV === "production") throw new Error("Use seed:prod for production permissions and the system administrator. The plan catalog is for development only.");
  console.log(`Catalog target: ${target.hostname}:${target.port || 3306}/${decodeURIComponent(target.pathname.slice(1))}`);
  const result = await seedCatalog(prisma, !args.includes("--apply"));
  console.log(JSON.stringify(result, null, 2));
  if (!result.dryRun) {
    // Invalidate even on a no-op retry to recover from a previous interrupted run.
    await invalidateModuleCache("plans");
  }
  console.log(result.dryRun ? "Dry run complete; use --apply to insert missing catalog entries." : "Catalog seed committed.");
} catch {
  // Adapter errors may contain connection details; keep operator output safe.
  console.error("Catalog seed failed. Check database connectivity, applied migrations, and global permission ownership. No partial catalog transaction was committed.");
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
