import { jest } from "@jest/globals";

const db = {
  organization: { findUnique: jest.fn(async () => ({ isDemo: true })) },
  subscription: { findUnique: jest.fn(async () => ({ organizationId: "demo-org" })) },
  subscriptionUpgradeRequest: { findUnique: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/utils/module-cache.js", () => ({ cachedRead: jest.fn(), invalidating: async (_resource: string, work: () => Promise<unknown>) => work() }));
jest.unstable_mockModule("@/modules/auth/authorization.js", () => ({ loadAuthorization: jest.fn(async () => ({ id: "owner", organizationId: "demo-org", role: { name: "Admin" } })) }));
jest.unstable_mockModule("@/modules/role/tenant-access-policy.js", () => ({ isTenantAdminName: (name: string) => name === "Admin", requirePlatformAuthority: jest.fn(async () => ({ id: "operator" })) }));
jest.unstable_mockModule("@/modules/system-admin/entitlement.js", () => ({ countReservedSeats: jest.fn(), assertTenantEntitlement: jest.fn() }));
jest.unstable_mockModule("@/modules/system-admin/platform-audit.js", () => ({ lockOrganization: jest.fn(), recordPlatformAudit: jest.fn() }));
jest.unstable_mockModule("@/utils/tenant-transaction.js", () => ({ tenantTransaction: async (work: (tx: typeof db) => Promise<unknown>) => work(db) }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {} }));
const { requestContext } = await import("@/lib/requestContext.js");
const { subscriptionUpgradeService: service } = await import("@/modules/organization/subscription-upgrade.service.js");
const tenant = <T>(work: () => Promise<T>) => requestContext.run({ requestId: "demo-upgrade", userId: "owner", organizationId: "demo-org" }, work);

test("demo owners cannot discover paid upgrades or create an upgrade request", async () => {
  await expect(tenant(() => service.plans())).rejects.toMatchObject({ code: "DEMO_ACTION_DISABLED" });
  await expect(tenant(() => service.request({ planId: "paid-plan", planUpdatedAt: new Date().toISOString(), idempotencyKey: "request-key", reason: "Increase capacity" }))).rejects.toMatchObject({ code: "DEMO_ACTION_DISABLED" });
  expect(db.subscriptionUpgradeRequest.create).not.toHaveBeenCalled();
});

test("platform operators cannot approve old demo upgrades", async () => {
  await expect(service.review("old-demo-subscription", { confirm: true, requestId: "old-upgrade", decision: "APPROVED", reason: "Review request" })).rejects.toMatchObject({ code: "DEMO_ACTION_DISABLED" });
  expect(db.subscriptionUpgradeRequest.update).not.toHaveBeenCalled();
});
