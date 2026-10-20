import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";
import { recordPlatformAudit } from "../../src/modules/system-admin/platform-audit.js";
import { seedPlanCatalog, subscriptionPlanCatalog } from "./plans.js";

// Global definitions only. Never create tenant data or change permission grants.
export async function seedCatalog(prisma: PrismaClient, dryRun = true) {
  return prisma.$transaction(async (db) => {
    const names = [...new Set(Object.values(PERMISSIONS))];
    const permissions = await db.permission.findMany({ where: { name: { in: names } } });
    if (permissions.some((permission) => permission.organizationId !== null)) {
      throw new Error("Catalog permission name conflicts with a tenant-owned definition; no changes applied.");
    }
    const missing = names.filter((name) => !permissions.some((permission) => permission.name === name));
    const plans = await db.plan.findMany({
      where: { name: { in: subscriptionPlanCatalog.map((plan) => plan.name) } },
      select: { name: true },
    });
    const missingPlans = subscriptionPlanCatalog.filter((item) => !plans.some((plan) => plan.name === item.name));
    if (!dryRun) {
      for (const name of missing) {
        const permission = await db.permission.create({
          data: { name, description: "Can " + name.replace(":", " "), organizationId: null },
        });
        await recordPlatformAudit(db, {
          action: "platform.permission.seed", entity: "Permission", entityId: permission.id,
          actorType: "OPERATOR", after: { name, source: "prisma/seed-catalog.ts" },
        });
      }
      await seedPlanCatalog(db);
    }
    return {
      dryRun,
      permissions: { create: missing, preserved: permissions.length },
      plans: { create: missingPlans, preserved: plans.length },
    };
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });
}
