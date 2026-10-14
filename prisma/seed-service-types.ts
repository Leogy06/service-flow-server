import { prisma } from "../src/lib/prisma.js";
import { seedServiceTypes } from "./seeds/serviceTypes.js";

try {
  const results = await seedServiceTypes(prisma);
  for (const result of results) {
    console.log(result.industry
      ? `${result.organization} (${result.industry}): added ${result.created} service types, ${result.existing} already exist`
      : `${result.organization}: skipped because its industry is unknown or ambiguous`);
  }
  console.log(`Service type seed complete: added ${results.reduce((total, result) => total + result.created, 0)} service types.`);
} catch (error) {
  console.error("Service type seed failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
