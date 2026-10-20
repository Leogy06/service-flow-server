import { Prisma, type PrismaClient } from "../../src/generated/prisma/client.js";
import { recordPlatformAudit } from "../../src/modules/system-admin/platform-audit.js";

export const subscriptionPlanCatalog = [
  { tier: "Starter", maxActiveUsers: 3, monthly: "299.00", yearly: "2999.00" },
  { tier: "Growth", maxActiveUsers: 10, monthly: "599.00", yearly: "5999.00" },
  { tier: "Business", maxActiveUsers: 25, monthly: "999.00", yearly: "9999.00" },
].flatMap(({ tier, maxActiveUsers, monthly, yearly }) => [
  { name: `${tier} Monthly`, description: `${tier} team access billed monthly.`, price: monthly, billingInterval: "MONTHLY" as const, currency: "PHP", maxActiveUsers, isActive: true },
  { name: `${tier} Yearly`, description: `${tier} team access billed yearly.`, price: yearly, billingInterval: "YEARLY" as const, currency: "PHP", maxActiveUsers, isActive: true },
]);

// Repeated seeds preserve edited prices/retirement and never enable tenant billing.
export async function seedPlanCatalog(db: Prisma.TransactionClient) {
  const results = [];
  for (const item of subscriptionPlanCatalog) {
    const existing = await db.plan.findUnique({ where: { name: item.name } });
    if (existing) {
      results.push({ name: existing.name, created: false });
      continue;
    }
    const plan = await db.plan.create({ data: { ...item, price: new Prisma.Decimal(item.price) } });
    await recordPlatformAudit(db, { action: "platform.plan.seed", entity: "Plan", entityId: plan.id, actorType: "OPERATOR",
      after: { ...item, reason: "Seed existing monthly and yearly plan catalog" } });
    results.push({ name: plan.name, created: true });
  }
  return results;
}

export async function seedPlans(prisma: PrismaClient) {
  return prisma.$transaction(seedPlanCatalog, { isolationLevel: "Serializable", timeout: 60000 });
}
