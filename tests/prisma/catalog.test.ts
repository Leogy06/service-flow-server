import { jest } from "@jest/globals";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";

const audit = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.unstable_mockModule("../../src/modules/system-admin/platform-audit.js", () => ({ recordPlatformAudit: audit }));
const { seedCatalog } = await import("../../prisma/seeds/catalog.js");
const { subscriptionPlanCatalog } = await import("../../prisma/seeds/plans.js");

type Row = Record<string, any>;
let permissions: Row[];
let plans: Row[];
const db = {
  permission: {
    findMany: jest.fn(async () => permissions),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const row = { id: `p-${permissions.length}`, ...data };
      permissions.push(row);
      return row;
    }),
  },
  plan: {
    findMany: jest.fn(async () => plans),
    findUnique: jest.fn(async ({ where }: { where: { name: string } }) => plans.find((plan) => plan.name === where.name)),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const row = { id: `plan-${plans.length}`, ...data };
      plans.push(row);
      return row;
    }),
  },
};
const client = {
  $transaction: async (work: (tx: typeof db) => Promise<unknown>) => {
    const beforePermissions = [...permissions];
    const beforePlans = [...plans];
    try { return await work(db); }
    catch (error) { permissions = beforePermissions; plans = beforePlans; throw error; }
  },
} as unknown as PrismaClient;

beforeEach(() => {
  permissions = [];
  plans = [];
  jest.clearAllMocks();
  audit.mockReset().mockResolvedValue(undefined);
});

test("default dry run previews all definitions without writes or audits", async () => {
  const result = await seedCatalog(client);
  expect(result.permissions.create).toHaveLength(Object.values(PERMISSIONS).length);
  expect(result.plans.create).toHaveLength(6);
  expect(db.permission.create).not.toHaveBeenCalled();
  expect(db.plan.create).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

test("apply is idempotent and records only newly created global definitions", async () => {
  await seedCatalog(client, false);
  const count = Object.values(PERMISSIONS).length + 6;
  expect(audit).toHaveBeenCalledTimes(count);
  expect(permissions.every((row) => row.organizationId === null)).toBe(true);
  const repeated = await seedCatalog(client, false);
  expect(repeated.permissions.create).toEqual([]);
  expect(repeated.plans.create).toEqual([]);
  expect(audit).toHaveBeenCalledTimes(count);
});

test("preserves edited descriptions and retired/custom-priced plans", async () => {
  permissions = [{ id: "existing", name: Object.values(PERMISSIONS)[0], organizationId: null, description: "Custom description" }];
  plans = [{ ...subscriptionPlanCatalog[0], id: "existing-plan", price: "123.45", isActive: false }];
  const before = { permission: { ...permissions[0] }, plan: { ...plans[0] } };
  await seedCatalog(client, false);
  expect(permissions[0]).toEqual(before.permission);
  expect(plans[0]).toEqual(before.plan);
});

test.each([true, false])("rejects tenant-owned permission collisions before writes (dryRun=%s)", async (dryRun) => {
  permissions = [{ name: Object.values(PERMISSIONS)[0], organizationId: "tenant-b" }];
  await expect(seedCatalog(client, dryRun)).rejects.toThrow("tenant-owned");
  expect(db.permission.create).not.toHaveBeenCalled();
  expect(db.plan.create).not.toHaveBeenCalled();
});

test("audit failure aborts the catalog transaction", async () => {
  audit.mockRejectedValueOnce(new Error("Audit unavailable"));
  await expect(seedCatalog(client, false)).rejects.toThrow("Audit unavailable");
  expect(permissions).toEqual([]);
  expect(plans).toEqual([]);
});

test("plan audit failure rolls back permissions and plans together", async () => {
  audit.mockImplementation(async (_db, input) => {
    if ((input as { entity: string }).entity === "Plan") throw new Error("Plan audit unavailable");
  });
  await expect(seedCatalog(client, false)).rejects.toThrow("Plan audit unavailable");
  expect(permissions).toEqual([]);
  expect(plans).toEqual([]);
});
