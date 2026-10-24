import { jest } from "@jest/globals";
import { Prisma } from "@/generated/prisma/client.js";

type RealTenantFilter = { organization?: { isDemo: boolean }; payment?: { organization?: { isDemo: boolean } } };
const tenants = [{ name: "Live business", isDemo: false }, { name: "Demo business", isDemo: true }];
const receipts = tenants.map((organization, index) => ({
  id: `receipt-${index}`, organization, referenceNumber: `reference-${index}`, currency: "PHP",
  amount: new Prisma.Decimal(100), verifiedAt: new Date("2026-10-02T00:00:00Z"),
}));
const refunds = receipts.map((payment, index) => ({
  id: `refund-${index}`, payment, currency: "PHP", amount: new Prisma.Decimal(25), createdAt: new Date("2026-10-03T00:00:00Z"),
}));
const count = () => jest.fn(async () => 0);
const db = {
  organization: { count: count() }, user: { count: count() },
  subscription: { count: count(), groupBy: jest.fn(async () => []) },
  auditLog: { count: count(), findMany: jest.fn(async () => []) },
  platformAlert: { findMany: jest.fn(async () => []) },
  subscriptionPayment: {
    count: count(),
    findMany: jest.fn(async ({ where }: { where: RealTenantFilter }) => receipts.filter((row) => where.organization?.isDemo === undefined || row.organization.isDemo === where.organization.isDemo)),
  },
  subscriptionRefund: {
    findMany: jest.fn(async ({ where }: { where: RealTenantFilter }) => refunds.filter((row) => where.payment?.organization?.isDemo === undefined || row.payment.organization.isDemo === where.payment.organization.isDemo)),
  },
  $queryRaw: jest.fn(async (parts: TemplateStringsArray) => {
    const sql = parts.join("?");
    if (!/FROM Subscription(Payment|Refund)/.test(sql)) return [];
    const amount = sql.includes("FROM SubscriptionRefund") ? 25 : 100;
    return [{ date: "2026-10-02", currency: "PHP", amount: String(amount * (sql.includes("isDemo") ? 1 : 2)) }];
  }),
};
const prisma = { ...db, $transaction: async <T>(work: (tx: typeof db) => Promise<T>) => work(db) };
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma }));
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: {} }));
jest.unstable_mockModule("@/modules/role/tenant-access-policy.js", () => ({ requirePlatformAuthority: jest.fn(async () => ({ id: "operator" })) }));
jest.unstable_mockModule("@/modules/system-admin/platform-audit.js", () => ({ lockOrganization: jest.fn(), platformTransaction: jest.fn(), recordPlatformAudit: jest.fn() }));
jest.unstable_mockModule("@/modules/system-admin/telemetry.js", () => ({ trafficSnapshot: jest.fn() }));
jest.unstable_mockModule("@/utils/module-cache.js", () => ({ cachedRead: async (_module: string, _operation: string, _query: unknown, work: () => Promise<unknown>) => work() }));
const { operationsService } = await import("@/modules/system-admin/operations.service.js");

test("financial CSV excludes demo receipts and refunds", async () => {
  const result = await operationsService.billingReport({ from: "2026-10-01", to: "2026-10-31" });
  expect(result.csv).toContain("Live business");
  expect(result.csv).not.toContain("Demo business");
  expect(result.csv.split("\r\n")).toHaveLength(3);
});

test("dashboard revenue aggregates exclude demo receipts and refunds", async () => {
  const result = await operationsService.dashboard({ from: "2026-10-01", to: "2026-10-31" });
  expect(result.revenue).toEqual([{ currency: "PHP", gross: "100.00", refunds: "25.00", net: "75.00" }]);
  const financialQueries = db.$queryRaw.mock.calls.map(([parts]) => parts.join("?")).filter((sql) => /FROM Subscription(Payment|Refund)/.test(sql));
  expect(financialQueries).toHaveLength(2);
  for (const sql of financialQueries) expect(sql).toMatch(/isDemo\s*=\s*FALSE/i);
});
