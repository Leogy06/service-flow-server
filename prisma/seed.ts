import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import { invalidateCache } from "../src/utils/cache.js";
import { seedAdminRoles } from "./seeds/adminRoles.js";

async function main() {
  const result = await seedAdminRoles(prisma);
  await invalidateCache("cache:users:list*");
  await invalidateCache("cache:user:byId*");
  console.log("Tenant Admin permission seed complete:", result);
}

try {
  await main();
} catch (error) {
  console.error("Tenant Admin permission seed failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
