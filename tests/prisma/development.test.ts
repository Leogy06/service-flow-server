import { jest } from "@jest/globals";
import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "../../src/generated/prisma/client.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";
import { DEFAULT_ROLE_DEFINITIONS } from "../../src/constants/default-roles.js";
import { assertDevelopmentSeedTarget, developmentPassword, developmentId, developmentOperatorEmail } from "../../prisma/seeds/development-data.js";

type Row = Record<string, unknown>;
type Arguments = { where?: Row; data?: Row };
const models = ["permission", "plan", "auditLog", "role", "user", "organization", "platformSettings", "organizationSettings", "organizationPage",
  "subscription", "subscriptionPayment", "subscriptionHistory", "subscriptionRefundRequest", "platformAlert", "signupRequest", "userPermission",
  "serviceType", "customer", "serviceRequest", "job", "invoice"] as const;
type Model = typeof models[number];
let rows: Record<Model, Row[]>;
let failAction: string | null;
const object = (value: unknown): value is Row => value !== null && typeof value === "object";
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, filter]) => {
    if (object(filter)) {
      if (Array.isArray(filter.in)) return filter.in.includes(row[key]);
      // Prisma compound unique selectors flatten to the row's component fields.
      return matches(row, filter);
    }
    return row[key] === filter;
  });
}
function delegate(model: Model) {
  const create = jest.fn(async ({ data = {} }: Arguments) => {
    if (model === "auditLog" && data.action === failAction) throw new Error("Simulated audit failure");
    const row: Row = { id: `${model}-${rows[model].length}`, organizationId: null, deletedAt: null,
      status: "ACTIVE", isActive: true, ...data };
    if (model === "serviceType") row.basePrice = new Prisma.Decimal(String(data.basePrice));
    if (rows[model].some((item) => item.id === row.id)) throw new Error("Unique ID conflict");
    rows[model].push(row);
    return row;
  });
  const findUnique = jest.fn(async ({ where }: Arguments) => {
    const row = rows[model].find((item) => matches(item, where)) ?? null;
    return model === "subscription" && row ? { ...row, plan: rows.plan.find((plan) => plan.id === row.planId) } : row;
  });
  return {
    create, findUnique,
    findMany: jest.fn(async ({ where }: Arguments = {}) => rows[model].filter((row) => matches(row, where))),
    count: jest.fn(async ({ where }: Arguments = {}) => rows[model].filter((row) => matches(row, where)).length),
    upsert: jest.fn(async ({ where, create: data }: Arguments & { create: Row }) => (await findUnique({ where })) ?? create({ data })),
  };
}
const db = Object.fromEntries(models.map((model) => [model, delegate(model)])) as Record<Model, ReturnType<typeof delegate>>;
const transaction = jest.fn(async (work: (tx: typeof db) => Promise<unknown>) => {
  const before = Object.fromEntries(models.map((model) => [model, rows[model].map((row) => ({ ...row }))])) as Record<Model, Row[]>;
  try { return await work(db); }
  catch (error) { rows = before; throw error; }
});
const client = { $transaction: transaction } as unknown as PrismaClient;
jest.unstable_mockModule("../../src/modules/system-admin/platform-audit.js", () => ({
  recordPlatformAudit: async (_tx: unknown, input: Row) => db.auditLog.create({ data: { ...input, scope: "PLATFORM" } }),
  lockOrganization: async () => undefined,
}));
const electrical = jest.fn(async () => ({ status: "created", organizationId: "electrical", summary: { serviceRequests: 25 } }));
jest.unstable_mockModule("../../prisma/seeds/bright-star.js", () => ({ seedBrightStarInTransaction: electrical }));
const { seedDevelopment } = await import("../../prisma/seeds/development.js");
const environment = { NODE_ENV: "development", DATABASE_URL: "mysql://sample:unused@127.0.0.1/seed_test", DEV_SEED_PASSWORD: "SampleOnly123!", SALT_ROUNDS: 4 };
const now = new Date("2026-10-21T02:00:00Z");

beforeEach(() => {
  rows = Object.fromEntries(models.map((model) => [model, []])) as unknown as Record<Model, Row[]>;
  failAction = null;
  jest.clearAllMocks();
});

test.each(["production", "test"])("refuses %s mode before hashing or database access", async (NODE_ENV) => {
  await expect(seedDevelopment(client, { ...environment, NODE_ENV }, { dryRun: false })).rejects.toThrow("NODE_ENV=development");
  expect(transaction).not.toHaveBeenCalled();
});

test.each(["db.example.test", "127.0.0.1.example.test", "0.0.0.0"])("refuses non-loopback host %s", (host) => {
  expect(() => assertDevelopmentSeedTarget({ ...environment, DATABASE_URL: `mysql://user:unused@${host}/test` })).toThrow("local MySQL");
});

test("reuses current registration password validation without accepting weak or oversized credentials", () => {
  for (const value of [undefined, "lowercase", "NoDigitsHere", "A1" + "a".repeat(71)]) expect(() => developmentPassword(value)).toThrow("DEV_SEED_PASSWORD");
  expect(developmentPassword(environment.DEV_SEED_PASSWORD)).toBe(environment.DEV_SEED_PASSWORD);
});

test("dry run needs no password and writes nothing", async () => {
  const result = await seedDevelopment(client, { ...environment, DEV_SEED_PASSWORD: undefined });
  expect(result.status).toBe("dry-run");
  expect(result.accounts).toHaveLength(10);
  expect(models.every((model) => rows[model].length === 0)).toBe(true);
  expect(electrical).not.toHaveBeenCalled();
});

test("apply without a valid password never opens a transaction", async () => {
  await expect(seedDevelopment(client, { ...environment, DEV_SEED_PASSWORD: undefined }, { dryRun: false })).rejects.toThrow("DEV_SEED_PASSWORD");
  expect(transaction).not.toHaveBeenCalled();
});

test("seeds independently owned accounts and workflows, defaults, billing and hashed credentials", async () => {
  const result = await seedDevelopment(client, environment, { dryRun: false, now });
  expect(result.status).toBe("created");
  expect(rows.organization).toHaveLength(3);
  expect(rows.user).toHaveLength(10);
  expect(rows.plan).toHaveLength(6);
  expect(rows.permission).toHaveLength(Object.values(PERMISSIONS).length);
  const operator = rows.user.find((row) => row.email === developmentOperatorEmail)!;
  expect(operator).toMatchObject({ organizationId: null, platformRole: "SYSTEM_ADMIN" });
  for (const user of rows.user) {
    expect(await bcrypt.compare(environment.DEV_SEED_PASSWORD, String(user.password))).toBe(true);
    const role = rows.role.find((row) => row.id === user.roleId)!;
    expect(role.organizationId).toBe(user.organizationId);
    if (user.id !== operator.id) expect(user.platformRole).toBe("NONE");
  }
  expect(rows.role).toHaveLength(10);
  expect(rows.userPermission).toHaveLength(3);
  expect(rows.userPermission.every((row) => row.isActive === false)).toBe(true);
  expect(rows.subscription.map((row) => row.status).sort()).toEqual(["ACTIVE", "PENDING", "TRIALING"]);
  const paid = rows.subscription.find((row) => row.status === "ACTIVE")!;
  const payment = rows.subscriptionPayment.find((row) => row.id === paid.currentPeriodPaymentId)!;
  expect(payment).toMatchObject({ subscriptionId: paid.id, organizationId: paid.organizationId, status: "PAID" });
  expect(payment.amount).toEqual(paid.price);
  expect(rows.subscriptionRefundRequest[0]).toMatchObject({ paymentId: payment.id, activePaymentId: payment.id });
  for (const invoice of rows.invoice) {
    const customer = rows.customer.find((row) => row.id === invoice.customerId)!;
    const job = rows.job.find((row) => row.id === invoice.jobId)!;
    expect(customer.organizationId).toBe(invoice.organizationId);
    expect(job.organizationId).toBe(invoice.organizationId);
    const total = invoice.total as Prisma.Decimal;
    expect(total.gt(invoice.amountPaid as Prisma.Decimal)).toBe(true);
    expect(invoice.status).toBe("PARTIALLY_PAID");
  }
  expect(rows.organizationPage).toHaveLength(3);
  expect(electrical).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain(environment.DEV_SEED_PASSWORD);
  expect(JSON.stringify(rows.auditLog)).not.toContain("$2");
});

test("reruns preserve changed passwords, descriptions, status and grants", async () => {
  await seedDevelopment(client, environment, { dryRun: false, now });
  rows.user[0]!.password = "changed-by-user";
  rows.organization[0]!.name = "Edited name";
  rows.plan[0]!.isActive = false;
  const before = JSON.stringify(rows);
  const result = await seedDevelopment(client, environment, { dryRun: false, now: new Date(now.getTime() + 86400000) });
  expect(result.status).toBe("already-seeded");
  expect(JSON.stringify(rows)).toBe(before);
  expect(electrical).toHaveBeenCalledTimes(1);
});

test("late audit failure rolls back catalogs, privileged accounts and business data together", async () => {
  failAction = "seed.development.completed";
  await expect(seedDevelopment(client, environment, { dryRun: false, now })).rejects.toThrow("Simulated audit failure");
  expect(models.every((model) => rows[model].length === 0)).toBe(true);
});

test("a reserved operator email cannot promote or overwrite an existing tenant account", async () => {
  rows.user.push({ id: "unrelated", email: developmentOperatorEmail, organizationId: "other-tenant", platformRole: "NONE", password: "untouched" });
  await expect(seedDevelopment(client, environment, { dryRun: false })).rejects.toThrow("another account");
  expect(rows.user).toEqual([{ id: "unrelated", email: developmentOperatorEmail, organizationId: "other-tenant", platformRole: "NONE", password: "untouched" }]);
  expect(rows.permission).toEqual([]);
});

test("existing tenant roles retain their customized grants", async () => {
  const orgId = developmentId("organization:acme-plumbing");
  rows.organization.push({ id: orgId, slug: "acme-plumbing", name: "Acme Plumbing Co.", status: "ACTIVE", billingEnabled: false });
  rows.role.push({ id: "custom-admin", name: "Admin", organizationId: orgId, deletedAt: null, permissions: { create: [] } });
  await seedDevelopment(client, environment, { dryRun: false, now });
  expect(rows.role.find((row) => row.id === "custom-admin")!.permissions).toEqual({ create: [] });
  expect(rows.role.filter((row) => row.organizationId === orgId)).toHaveLength(DEFAULT_ROLE_DEFINITIONS.length);
});

test("existing subscription seat limits include new sample accounts and roll back on overflow", async () => {
  const orgId = developmentId("organization:acme-plumbing");
  rows.organization.push({ id: orgId, slug: "acme-plumbing", name: "Acme Plumbing Co.", status: "ACTIVE", billingEnabled: true });
  rows.plan.push({ id: "existing-plan", name: "Small legacy plan", maxActiveUsers: 1 });
  rows.subscription.push({ id: "existing-subscription", organizationId: orgId, planId: "existing-plan" });
  await expect(seedDevelopment(client, environment, { dryRun: false, now })).rejects.toThrow("user limit");
  expect(rows.user).toEqual([]);
  expect(rows.subscription).toHaveLength(1);
  expect(rows.plan).toHaveLength(1);
});

test("inactive organizations are preserved and fail the entire batch", async () => {
  rows.organization.push({ id: "inactive-org", slug: "acme-plumbing", status: "SUSPENDED" });
  await expect(seedDevelopment(client, environment, { dryRun: false })).rejects.toThrow("inactive");
  expect(rows.organization).toEqual([{ id: "inactive-org", slug: "acme-plumbing", status: "SUSPENDED" }]);
  expect(rows.user).toEqual([]);
});

test("a forged completion marker cannot skip ownership checks", async () => {
  rows.auditLog.push({ id: developmentId("batch"), scope: "TENANT", organizationId: "foreign", action: "seed.development.completed" });
  await expect(seedDevelopment(client, environment)).rejects.toThrow("marker ownership mismatch");
});
