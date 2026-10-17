import { jest } from "@jest/globals";

// Real services + real cache utility; only Redis and the database are in-memory.
type Row = Record<string, any>;
let customers: Row[], requests: Row[], jobs: Row[], invoices: Row[], payments: Row[];
const store = new Map<string, string>();
const redis = {
  get: jest.fn(async (key: string) => store.get(key) ?? null),
  set: jest.fn(async (key: string, value: string) => { store.set(key, value); return "OK"; }),
  incr: jest.fn(async (key: string) => { const version = Number(store.get(key) ?? 0) + 1; store.set(key, String(version)); return version; }),
  scan: jest.fn(async (_cursor: string, _match: string, pattern: string) => ["0", [...store.keys()].filter((key) => key.startsWith(pattern.slice(0, -1)))]),
  del: jest.fn(async (...keys: string[]) => { keys.forEach((key) => store.delete(key)); return keys.length; }),
};
const match = (row: Row, where: Row): boolean => Object.entries(where).every(([key, value]) => {
  if (value === undefined) return true;
  if (key === "AND") return value.every((clause: Row) => match(row, clause));
  if (value && typeof value === "object") return match(row[key] ?? {}, value);
  return row[key] === value;
});
const customer = (row: Row) => customers.find((item) => item.id === row.customerId);
const requestView = (row: Row) => ({ ...row, customer: customer(row) });
const jobView = (row: Row) => ({ ...row, customer: customer(row), serviceRequest: requests.find((item) => item.id === row.serviceRequestId) });
const invoiceView = (row: Row) => ({ ...row, customer: customer(row), payments: payments.filter((item) => item.invoiceId === row.id) });
function model(rows: () => Row[], view: (row: Row) => Row = (row) => row) {
  return {
    count: jest.fn(async ({ where }: Row) => rows().filter((row) => match(row, where)).length),
    findFirst: jest.fn(async ({ where }: Row) => { const row = rows().find((row) => match(row, where)); return row ? view(row) : null; }),
    findUnique: jest.fn(async ({ where }: Row) => { const row = rows().find((row) => match(row, where)); return row ? view(row) : null; }),
    findFirstOrThrow: jest.fn(async ({ where }: Row) => view(rows().find((row) => match(row, where))!)),
    findMany: jest.fn(async ({ where }: Row) => rows().filter((row) => match(row, where)).map(view)),
    update: jest.fn(async ({ where, data }: Row) => { const row = rows().find((row) => match(row, where))!; Object.assign(row, data); return view(row); }),
  };
}
const db = {
  customer: model(() => customers), serviceRequest: model(() => requests, requestView), job: model(() => jobs, jobView),
  invoice: model(() => invoices, invoiceView),
  user: { findFirst: jest.fn(async () => ({ id: "staff-a" })) },
  payment: {
    findFirst: jest.fn(async ({ where }: Row) => payments.find((row) => row.id === where.id) ?? null),
    create: jest.fn(async ({ data }: Row) => { payments.push(data); return data; }),
  },
  $queryRaw: jest.fn(async () => [{ id: "invoice-a" }]),
  $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger: { error: jest.fn() } }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: { record: jest.fn(async () => {}), recordInTransaction: jest.fn(async () => {}) } }));
jest.unstable_mockModule("@/modules/role/tenant-access-policy.js", () => ({ isTenantAdminName: (role: string) => role === "Admin" }));
const { Prisma } = await import("@/generated/prisma/client.js");
const { requestContext } = await import("@/lib/requestContext.js");
const { customerService } = await import("@/modules/customer/customer.service.js");
const { serviceRequestService } = await import("@/modules/service-request/service-request.service.js");
const { jobService } = await import("@/modules/job/job.service.js");
const { invoiceService } = await import("@/modules/invoice/invoice.service.js");
const { paymentService } = await import("@/modules/payment/payment.service.js");
const { dashboardService } = await import("@/modules/dashboard/dashboard.service.js");
const { requestListInput } = await import("@/modules/service-request/service-request.schema.js");
const { jobListInput } = await import("@/modules/job/job.schema.js");
const requestQuery = requestListInput.parse({ query: {} }).query;
const jobQuery = jobListInput.parse({ query: {} }).query;
const tenant = <T>(work: () => T, organizationId = "org-a", userId = "staff-a", permissions = ["dashboard:read"]) =>
  requestContext.run({ requestId: "service-cache-test", organizationId, userId, role: "Staff", permissions }, work);
beforeEach(() => {
  store.clear(); jest.clearAllMocks();
  customers = [{ id: "customer-a", organizationId: "org-a", name: "Original name", deletedAt: null }];
  requests = [{ id: "request-a", organizationId: "org-a", customerId: "customer-a", status: "PENDING" }];
  jobs = [{ id: "job-a", organizationId: "org-a", customerId: "customer-a", serviceRequestId: "request-a", assignedStaffId: "staff-a", status: "ASSIGNED" }];
  invoices = [{ id: "invoice-a", organizationId: "org-a", customerId: "customer-a", total: new Prisma.Decimal(100), amountPaid: new Prisma.Decimal(0), status: "UNPAID" }];
  payments = [];
});

test("customer edits refresh cached customer, request and job projections", async () => {
  await tenant(() => customerService.get("customer-a"));
  await tenant(() => serviceRequestService.list(requestQuery));
  await tenant(() => jobService.list(jobQuery));
  await tenant(() => serviceRequestService.list(requestQuery));
  expect(db.serviceRequest.findMany).toHaveBeenCalledTimes(1);
  await tenant(() => customerService.update("customer-a", { name: "New name" }));
  expect((await tenant(() => customerService.get("customer-a"))).name).toBe("New name");
  expect((await tenant(() => serviceRequestService.list(requestQuery))).requests[0]?.customer.name).toBe("New name");
  expect((await tenant(() => jobService.list(jobQuery))).jobs[0]?.customer.name).toBe("New name");
  expect(db.serviceRequest.findMany).toHaveBeenCalledTimes(2);
});

test("starting a job refreshes both the job cache and the automatically started parent request", async () => {
  await tenant(() => serviceRequestService.list(requestQuery));
  await tenant(() => jobService.get("job-a"));
  await tenant(() => jobService.status("job-a", "IN_PROGRESS", "Started"));
  expect((await tenant(() => serviceRequestService.list(requestQuery))).requests[0]?.status).toBe("IN_PROGRESS");
  expect((await tenant(() => jobService.get("job-a"))).status).toBe("IN_PROGRESS");
  expect(db.serviceRequest.findMany).toHaveBeenCalledTimes(2);
});

test("cached invoice reads preserve Decimal behavior and refresh after a committed payment", async () => {
  expect((await tenant(() => invoiceService.get("invoice-a"))).balance).toBe("100.00");
  expect((await tenant(() => invoiceService.get("invoice-a"))).total.sub(1).toFixed(2)).toBe("99.00");
  expect(db.invoice.findFirst).toHaveBeenCalledTimes(1);
  await tenant(() => paymentService.record("invoice-a", {
    amount: "25.00", method: "CASH", idempotencyKey: "12345678-1234-4234-8234-123456789012", referenceNumber: "", notes: "",
  }));
  const updated = await tenant(() => invoiceService.get("invoice-a"));
  expect(updated.balance).toBe("75.00");
  expect(updated.status).toBe("PARTIALLY_PAID");
  expect(updated.payments).toHaveLength(1);
});

test("payment limits read live database balances even when an older invoice response is cached", async () => {
  await tenant(() => invoiceService.get("invoice-a"));
  // Simulate a competing committed payment while this request still has an old cached response.
  invoices[0]!.amountPaid = new Prisma.Decimal(90);
  await expect(tenant(() => paymentService.record("invoice-a", {
    amount: "25.00", method: "CASH", idempotencyKey: "12345678-1234-4234-8234-123456789012", referenceNumber: "", notes: "",
  }))).rejects.toMatchObject({ statusCode: 409 });
  expect(db.payment.create).not.toHaveBeenCalled();
  expect(redis.incr).not.toHaveBeenCalled();
});

test("warm detail caches cannot expose another tenant's records or bypass a missing tenant", async () => {
  await tenant(() => jobService.get("job-a"));
  await expect(tenant(() => jobService.get("job-a"), "org-b")).rejects.toMatchObject({ statusCode: 404 });
  await expect(jobService.get("job-a")).rejects.toMatchObject({ statusCode: 403 });
});

test("mine lists remain isolated between staff in one tenant", async () => {
  const mine = { ...jobQuery, mine: "true" as const };
  expect((await tenant(() => jobService.list(mine))).jobs).toHaveLength(1);
  expect((await tenant(() => jobService.list(mine), "org-a", "staff-b")).jobs).toHaveLength(0);
});

test("dashboard permission checks still run before reading a warm cache", async () => {
  await tenant(() => dashboardService.get());
  await tenant(() => dashboardService.get());
  expect(db.$transaction).toHaveBeenCalledTimes(1);
  await expect(tenant(() => dashboardService.get(), "org-a", "staff-a", [])).rejects.toMatchObject({ statusCode: 403 });
  expect(db.$transaction).toHaveBeenCalledTimes(1);
});
