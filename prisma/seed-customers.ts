import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import { invalidateCache } from "../src/utils/cache.js";
import { seedCustomers } from "./seeds/customers.js";

try {
  const results = await seedCustomers(prisma);
  for (const result of results) {
    await invalidateCache(`cache:customers:list:${result.organizationId}:*`);
    console.log(`${result.organization}: added ${result.created} customers (${result.before} -> ${result.after})`);
  }
  console.log(`Customer seed complete: added ${results.reduce((total, result) => total + result.created, 0)} customers across ${results.length} organizations.`);
} catch (error) {
  console.error("Customer seed failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await prisma.$disconnect();
}
