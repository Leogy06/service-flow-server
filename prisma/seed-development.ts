import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import { invalidateModuleCache } from "../src/utils/module-cache.js";
import { seedDevelopment } from "./seeds/development.js";

try {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => !["--dry-run", "--apply"].includes(flag)) || (flags.includes("--dry-run") && flags.includes("--apply"))) {
    throw new Error("Usage: npm run seed:dev -- [--dry-run | --apply]");
  }
  const result = await seedDevelopment(prisma, { ...env, DEV_SEED_PASSWORD: process.env.DEV_SEED_PASSWORD }, { dryRun: !flags.includes("--apply") });
  if (flags.includes("--apply")) {
    await invalidateModuleCache("plans");
    for (const organizationId of result.organizationIds) {
      await invalidateModuleCache(["customers", "serviceTypes", "serviceRequests", "jobs", "invoices", "users", "roles", "branding"], organizationId);
    }
  }
  console.log(JSON.stringify(result, null, 2));
  console.log(flags.includes("--apply") ? "Development seed complete. New accounts use DEV_SEED_PASSWORD; existing credentials are preserved."
    : "Dry run complete. Set DEV_SEED_PASSWORD in .env.development and use --apply to seed.");
} catch (error) {
  console.error("Development seed failed:", error instanceof Error && !("code" in error)
    ? error.message : "Database operation failed. No partial seed committed; check connectivity, migrations and unique-field collisions.");
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
