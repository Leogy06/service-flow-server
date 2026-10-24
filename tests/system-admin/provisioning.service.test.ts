import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { TENANT_ADMIN_PERMISSIONS } from "../../src/constants/default-roles.js";

type Row = Record<string, any>;
const names = ["tenantProvisioning", "organization", "user", "role", "serviceType", "customer", "serviceRequest", "job", "jobStatusHistory", "invoice", "invoiceItem", "payment", "organizationPage", "subscription", "subscriptionHistory", "auditLog", "feedbackInvitation", "signupRequest"] as const;
type Table = typeof names[number];
let rows: Record<Table, Row[]>;
let failAudit = false;
let permissionsReady = true;
let planActive = true;
let privileged = true;
let failEmail = false;
let extraReference = false;
const deliveries: { to: string; firstName: string; token: string }[] = [];
const sendInvitation = jest.fn(async (mail: typeof deliveries[number]) => {
  deliveries.push(mail);
  if (failEmail) throw new Error("Provider response includes private delivery metadata");
  return { id: "delivery" };
});
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return (expected as Row[]).some((condition) => matches(row, condition));
    if (key === "AND") return (expected as Row[]).every((condition) => matches(row, condition));
    if (key === "invoice") return matches(rows.invoice.find((invoice) => invoice.id === row.invoiceId) ?? {}, expected);
    if (key === "job") return matches(rows.job.find((job) => job.id === row.jobId) ?? {}, expected);
    if (key === "organization") return matches(rows.organization.find((org) => org.id === row.organizationId) ?? {}, expected);
    if (key === "role") return matches(rows.role.find((role) => role.id === row.roleId) ?? {}, expected);
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if ("in" in expected && !expected.in.includes(row[key])) return false;
      if ("notIn" in expected && expected.notIn.includes(row[key])) return false;
      if ("not" in expected && row[key] === expected.not) return false;
      if ("gt" in expected && !(row[key] > expected.gt)) return false;
      return true;
    }
    return expected === undefined || row[key] === expected;
  });
}
const db: Row = {};
for (const table of names) {
  db[table] = {
    findUnique: jest.fn(async ({ where }: Row) => {
      if (table === "user" && where.id === "operator") return {
        id: "operator", email: "operator@example.test", firstName: "Platform", lastName: "Operator",
        status: "ACTIVE", securityStatus: "ACTIVE", deletedAt: null, sessionVersion: 0,
        organizationId: privileged ? null : "foreign", platformRole: privileged ? "SYSTEM_ADMIN" : "NONE",
        organization: privileged ? null : { id: "foreign", slug: "foreign", status: "ACTIVE", billingEnabled: false },
        role: { organizationId: privileged ? null : "foreign", name: privileged ? "Platform operator" : "Admin", deletedAt: null, permissions: [] }, userPermissions: [],
      };
      return rows[table].find((row) => matches(row, where)) ?? null;
    }),
    findFirst: jest.fn(async ({ where }: Row) => rows[table].find((row) => matches(row, where)) ?? null),
    findMany: jest.fn(async ({ where }: Row = {}) => rows[table].filter((row) => matches(row, where))),
    count: jest.fn(async ({ where }: Row = {}) => {
      if (extraReference && table === "serviceRequest" && where?.id?.notIn) return 1;
      return rows[table].filter((row) => matches(row, where)).length;
    }),
    create: jest.fn(async ({ data }: Row) => {
      if (table === "auditLog" && failAudit) throw new Error("Audit unavailable");
      const row = { id: `${table}-${rows[table].length}`, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, securityStatus: "ACTIVE", password: null, ...(table === "organization" ? { status: "ACTIVE" } : {}), ...data };
      rows[table].push(row); return row;
    }),
    createMany: jest.fn(async ({ data }: Row) => {
      for (const entry of data) await db[table].create({ data: entry });
      return { count: data.length };
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = rows[table].find((entry) => matches(entry, where));
      if (!row) throw new Error(`Missing ${table}`);
      Object.assign(row, data, { updatedAt: new Date() }); return row;
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const targets = rows[table].filter((row) => matches(row, where));
      targets.forEach((row) => Object.assign(row, data, { updatedAt: new Date() })); return { count: targets.length };
    }),
    deleteMany: jest.fn(async ({ where }: Row) => {
      const before = rows[table].length;
      rows[table] = rows[table].filter((row) => !matches(row, where)); return { count: before - rows[table].length };
    }),
  };
}
db.permission = { findMany: jest.fn(async () => permissionsReady ? TENANT_ADMIN_PERMISSIONS.map((name, index) => ({ id: `permission-${index}`, name })) : []) };
db.plan = { findUnique: jest.fn(async () => ({ id: "plan", isActive: planActive, maxActiveUsers: 5, price: "999.00", currency: "PHP", billingInterval: "MONTHLY" })) };
db.$queryRaw = jest.fn(async (_sql: TemplateStringsArray, id: string) => rows.organization.some((row) => row.id === id) ? [{ id }] : []);
db.$transaction = jest.fn(async (work: (tx: unknown) => Promise<unknown>) => {
  const snapshot = Object.fromEntries(names.map((table) => [table, rows[table].map((row) => ({ ...row }))])) as Record<Table, Row[]>;
  try { return await work(db); } catch (error) { rows = snapshot; throw error; }
});
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/lib/logger", () => ({ logger: { info: jest.fn() } }));
jest.unstable_mockModule("@/lib/email/send-invite", () => ({ sendInviteEmail: sendInvitation }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn() }));
const { requestContext } = await import("@/lib/requestContext.js");
const { createProvisioningService } = await import("@/modules/system-admin/provisioning/provisioning.service.js");
const service = createProvisioningService({ sendInvitation });
const operator = <T>(work: () => Promise<T>) => requestContext.run({ requestId: "provisioning-test", userId: "operator" }, work);
const input = {
  idempotencyKey: "9b112271-de6b-47ae-a2a6-1be4b844641e", templateId: "AIRCON", mode: "REAL",
  organization: { name: "New Aircon Services", slug: "new-aircon" },
  owner: { firstName: "Marina", lastName: "Santos", email: "owner@example.test" },
  planId: "plan", reason: "Verified owner onboarding", confirm: true,
} as const;
beforeEach(() => {
  rows = Object.fromEntries(names.map((name) => [name, []])) as Record<Table, Row[]>;
  failAudit = false; permissionsReady = true; planActive = true; privileged = true;
  failEmail = false; extraReference = false; deliveries.length = 0; jest.clearAllMocks();
});

test("real provisioning creates a draft, inactive unpriced catalog, default roles and pending owner without operational data", async () => {
  const result = await operator(() => service.create(input));
  expect(result).toMatchObject({ mode: "REAL", invitationStatus: "SENT", organization: { name: input.organization.name, isDemo: false, billingEnabled: true }, owner: { status: "PENDING" }, counts: { services: 6, customers: 0, jobs: 0, invoices: 0, payments: 0 }, website: { generated: true, published: false } });
  expect(rows.role.map((role) => role.name)).toEqual(["Admin", "Manager", "Staff"]);
  expect(rows.serviceType.every((type) => type.basePrice.toString() === "0" && type.isActive === false && /pricing/i.test(type.description))).toBe(true);
  expect(rows.user[0]).toMatchObject({ password: null, status: "PENDING", platformRole: "NONE", roleId: rows.role[0].id });
  expect(rows.subscription[0]).toMatchObject({ status: "TRIALING" });
  expect(rows.subscription[0].trialExpiresAt.getTime() - rows.subscription[0].trialStartedAt.getTime()).toBe(14 * 86_400_000);
  expect(rows.organizationPage[0].draft).toMatchObject({ phone: "", email: "", address: "" });
  expect(rows.organizationPage[0].publishedAt).toBeUndefined();
  expect(rows.user[0].inviteToken).toBe(createHash("sha256").update(deliveries[0].token).digest("hex"));
  expect(JSON.stringify(result)).not.toContain(deliveries[0].token);
  expect(JSON.stringify(rows.auditLog)).not.toContain(deliveries[0].token);
});

test("replaying the same normalized request returns the workspace without creating rows or sending another invitation", async () => {
  const result = await operator(() => service.create(input));
  const replay = await operator(() => service.create({ ...input, owner: { ...input.owner, email: " OWNER@EXAMPLE.TEST " } }));
  expect(replay.id).toBe(result.id); expect(rows.organization).toHaveLength(1); expect(deliveries).toHaveLength(1);
  await expect(operator(() => service.create({ ...input, organization: { ...input.organization, name: "Changed name" } }))).rejects.toMatchObject({ statusCode: 409 });
  expect(rows.organization[0].name).toBe(input.organization.name);
});

test.each(["permissions", "plan", "audit"])("provisioning rolls back all resources when %s fails and permits same-key retry", async (kind) => {
  if (kind === "permissions") permissionsReady = false;
  if (kind === "plan") planActive = false;
  if (kind === "audit") failAudit = true;
  await expect(operator(() => service.create(input))).rejects.toThrow();
  expect(rows.organization).toEqual([]); expect(rows.tenantProvisioning).toEqual([]); expect(rows.user).toEqual([]); expect(deliveries).toEqual([]);
  permissionsReady = true; planActive = true; failAudit = false;
  expect((await operator(() => service.create(input))).organization.slug).toBe(input.organization.slug);
});

test("tenant or stale platform authority cannot provision or inspect a record", async () => {
  privileged = false;
  await expect(operator(() => service.create(input))).rejects.toMatchObject({ statusCode: 403 });
  await expect(operator(() => service.get("a".repeat(64)))).rejects.toMatchObject({ statusCode: 403 });
  expect(rows.organization).toEqual([]); expect(deliveries).toEqual([]);
});

test("delivery failure leaves a provisioned workspace and safe failed status; retry rotates token without duplicating resources", async () => {
  failEmail = true;
  const failed = await operator(() => service.create(input));
  expect(failed.invitationStatus).toBe("FAILED");
  expect(failed.invitationError).toBe("Invitation delivery failed. Retry after checking email delivery.");
  expect(JSON.stringify(failed)).not.toMatch(/Provider response|private delivery/);
  const originalHash = rows.user[0].inviteToken;
  failEmail = false;
  const sent = await operator(() => service.resendInvitation(failed.id, { reason: "Retry owner invitation", confirm: true }));
  expect(sent.invitationStatus).toBe("SENT"); expect(rows.user[0].inviteToken).not.toBe(originalHash);
  expect(rows.organization).toHaveLength(1); expect(rows.user).toHaveLength(1);
});

test("fresh delivery leases reject overlapping retries; stale leases can be recovered", async () => {
  const result = await operator(() => service.create(input));
  rows.tenantProvisioning[0].invitationStatus = "SENDING";
  rows.tenantProvisioning[0].invitationAttemptedAt = new Date();
  await expect(operator(() => service.resendInvitation(result.id, { reason: "Retry owner invitation", confirm: true }))).rejects.toMatchObject({ statusCode: 409 });
  rows.tenantProvisioning[0].invitationAttemptedAt = new Date(Date.now() - 6 * 60_000);
  expect((await operator(() => service.resendInvitation(result.id, { reason: "Recover stale delivery", confirm: true }))).invitationStatus).toBe("SENT");
});

test("demo fixtures stay fictional, scoped, unpaid by real providers, and reset without touching custom records", async () => {
  const result = await operator(() => service.create({ ...input, mode: "DEMO", planId: undefined, includeDemoData: true }));
  expect(result).toMatchObject({ organization: { isDemo: true, billingEnabled: false }, counts: { customers: 3, requests: 3, jobs: 3, invoices: 2, payments: 2 } });
  expect(rows.subscription).toEqual([]);
  expect(rows.customer.every((customer) => customer.email.endsWith(".example.test") && /demo sample/i.test(customer.name))).toBe(true);
  expect(rows.serviceRequest.every((request) => request.organizationId === result.organization.id && request.trackingToken === null)).toBe(true);
  expect(rows.invoice.map((invoice) => invoice.status)).toEqual(["PAID", "PARTIALLY_PAID"]);
  expect(rows.job.every((job) => !job.startedAt || job.createdAt <= job.startedAt)).toBe(true);
  expect(rows.jobStatusHistory.every((history) => history.createdAt <= new Date())).toBe(true);
  const originalCustomerIds = rows.customer.map((customer) => customer.id);
  rows.customer.push({ id: "custom-customer", organizationId: result.organization.id, name: "User-created customer" });
  const reset = await operator(() => service.resetDemo(result.id, { reason: "Restore sample scenarios", confirm: true }));
  expect(reset.counts.customers).toBe(4);
  expect(rows.customer.map((customer) => customer.id)).toEqual(expect.arrayContaining([...originalCustomerIds, "custom-customer"]));
  expect(rows.role).toHaveLength(3); expect(rows.serviceType).toHaveLength(6); expect(deliveries).toHaveLength(1);
});

test("reset refuses real workspaces and custom references without deleting anything", async () => {
  const real = await operator(() => service.create(input));
  await expect(operator(() => service.resetDemo(real.id, { reason: "Reset sample scenarios", confirm: true }))).rejects.toMatchObject({ statusCode: 409 });
  const demo = await operator(() => service.create({ ...input, idempotencyKey: "fb9a381f-56dd-4bf6-96b9-919e4f63e899", mode: "DEMO", planId: undefined, includeDemoData: true, owner: { ...input.owner, email: "demo@example.test" }, organization: { name: "Demo Business", slug: "demo-business" } }));
  const customerIds = rows.customer.map((customer) => customer.id); extraReference = true;
  await expect(operator(() => service.resetDemo(demo.id, { reason: "Reset sample scenarios", confirm: true }))).rejects.toMatchObject({ statusCode: 409 });
  expect(rows.customer.map((customer) => customer.id)).toEqual(customerIds);
});
