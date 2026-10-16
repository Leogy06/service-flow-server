import { jest } from "@jest/globals";
import type { Prisma } from "@/generated/prisma/client.js";

let organization: { id: string; billingEnabled: boolean } | null;
let subscription: Record<string, any> | null;
let gracePeriodDays = 0;
let activeUsers = 1;
const lockOrganization = jest.fn(async () => {});
const db = {
  organization: { findUnique: jest.fn(async () => organization) },
  subscription: { findUnique: jest.fn(async () => subscription) },
  platformSettings: { findUnique: jest.fn(async () => ({ gracePeriodDays })) },
  user: { count: jest.fn(async () => activeUsers) },
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/modules/system-admin/platform-audit.js", () => ({ lockOrganization }));
const { assertTenantEntitlement, enforceSeatLimit } = await import("@/modules/system-admin/entitlement.js");
const tx = db as unknown as Prisma.TransactionClient;
beforeEach(() => {
  jest.clearAllMocks(); organization = { id: "org-a", billingEnabled: true }; gracePeriodDays = 0; activeUsers = 1;
  subscription = { status: "ACTIVE", startsAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() + 86_400_000), plan: { maxActiveUsers: 3 } };
});

test("legacy tenants retain access without a fabricated subscription", async () => {
  organization!.billingEnabled = false; subscription = null;
  await expect(assertTenantEntitlement(tx, "org-a")).resolves.toBeUndefined();
  expect(db.subscription.findUnique).not.toHaveBeenCalled();
});

test.each(["PENDING", "EXPIRED", "CANCELED"])("billing-enabled tenants cannot use %s subscriptions", async (status) => {
  subscription!.status = status;
  await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403 });
});

test("missing, not-yet-started and expired subscriptions fail closed", async () => {
  subscription = null;
  await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403 });
  subscription = { status: "ACTIVE", startsAt: new Date(Date.now() + 86_400_000), expiresAt: new Date(Date.now() + 172_800_000) };
  await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403 });
  subscription.startsAt = new Date(Date.now() - 172_800_000); subscription.expiresAt = new Date(Date.now() - 86_400_000);
  await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403 });
});

test("grace is server configured and limited to PAST_DUE", async () => {
  subscription!.status = "PAST_DUE"; subscription!.expiresAt = new Date(Date.now() - 86_400_000);
  await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403 });
  gracePeriodDays = 2;
  await expect(assertTenantEntitlement(tx, "org-a")).resolves.toBeUndefined();
  subscription!.status = "EXPIRED";
  await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403 });
});

test("seat activation locks the organization and counts blocked active accounts", async () => {
  activeUsers = 3;
  await expect(enforceSeatLimit(tx, "org-a")).rejects.toMatchObject({ statusCode: 409 });
  expect(lockOrganization).toHaveBeenCalledWith(tx, "org-a");
  expect(db.user.count).toHaveBeenCalledWith({ where: { organizationId: "org-a", status: "ACTIVE", deletedAt: null, platformRole: "NONE" } });
});

test("seat boundary accepts the final seat and rejects any excess", async () => {
  activeUsers = 2;
  await expect(enforceSeatLimit(tx, "org-a", 1)).resolves.toBeUndefined();
  await expect(enforceSeatLimit(tx, "org-a", 2)).rejects.toMatchObject({ statusCode: 409 });
});

test("enabled tenants without an assigned plan cannot activate accounts", async () => {
  subscription = null;
  await expect(enforceSeatLimit(tx, "org-a")).rejects.toMatchObject({ statusCode: 409 });
});
