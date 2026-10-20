import type { Prisma, PrismaClient } from "../../src/generated/prisma/client.js";
import { seedPermissionCatalog } from "./permission-catalog.js";
import { seedPlanCatalog, subscriptionPlanCatalog } from "./plans.js";

// Global definitions only. Never create tenant data or change permission grants.
export async function seedCatalogInTransaction(db: Prisma.TransactionClient, dryRun = true) {
    const permissions = await seedPermissionCatalog(db, dryRun);
    const plans = await db.plan.findMany({
      where: { name: { in: subscriptionPlanCatalog.map((plan) => plan.name) } },
      select: { name: true },
    });
    const missingPlans = subscriptionPlanCatalog.filter((item) => !plans.some((plan) => plan.name === item.name));
    if (!dryRun) {
      await seedPlanCatalog(db);
    }
    return {
      dryRun,
      permissions,
      plans: { create: missingPlans, preserved: plans.length },
    };
}

export async function seedCatalog(prisma: PrismaClient, dryRun = true) {
  return prisma.$transaction((db) => seedCatalogInTransaction(db, dryRun),
    { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });
}
