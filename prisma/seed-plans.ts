import { prisma } from "../src/lib/prisma.js";
import { seedPlans } from "./seeds/plans.js";

try {
  const results = await seedPlans(prisma);
  for (const result of results) console.log(`${result.name}: ${result.created ? "created" : "already exists (preserved)"}`);
  console.log(`Plan seed complete: ${results.filter((result) => result.created).length} created, ${results.filter((result) => !result.created).length} preserved.`);
} catch (error) {
  console.error("Plan seed failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
