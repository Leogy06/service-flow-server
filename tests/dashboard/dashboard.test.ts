import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { Prisma } from "../../src/generated/prisma/client.js";
import { PERMISSIONS as P } from "../../src/constants/permission.constants.js";
import { dashboardPeriods } from "../../src/modules/dashboard/periods.js";

const now = new Date("2026-10-13T02:00:00Z");
let sessions: Record<string, any>;
let jobs: any[], requests: any[], invoices: any[], payments: any[], customers: any[];
function session(id: string, role: string, organizationId: string | null) {
  return { id, email: `${id}@example.com`, firstName: "Test", lastName: "User", status: "ACTIVE", deletedAt: null,
    platformRole: id === "platform" ? "SYSTEM_ADMIN" : "NONE", securityStatus: "ACTIVE", sessionVersion: 0,
    organizationId, organization: organizationId ? { id: organizationId, slug: organizationId, status: "ACTIVE", billingEnabled: false } : null,
    role: { id: `role-${id}`, name: role, organizationId, deletedAt: null,
      permissions: Object.values(P).map((name) => ({ permission: { id: name, name, organizationId: null } })) }, userPermissions: [] };
}
function reset() {
  sessions = { "admin-a": session("admin-a", "Admin", "org-a"), "staff-a": session("staff-a", "Staff", "org-a"),
    "admin-b": session("admin-b", "TENANT_ADMIN", "org-b"), "manager-a": session("manager-a", "Manager", "org-a"),
    platform: session("platform", "PLATFORM_ADMIN", null) };
  const job = (id: string, org: string, staff: string | null, status: string, overrides: any = {}) => ({
    id, organizationId: org, assignedStaffId: staff, status, referenceNumber: id, description: "Repair", location: "Site",
    customer: { name: `Customer-${org}`, organizationId: org }, serviceType: { name: "Repair", organizationId: org },
    assignedStaff: staff ? { firstName: staff, lastName: "User", organizationId: org } : null,
    serviceRequestId: null, serviceRequest: null, invoice: null, scheduledStart: null, scheduledEnd: null,
    completedAt: null, createdAt: new Date("2026-10-01T00:00:00Z"), ...overrides,
  });
  jobs = [
    job("late-a", "org-a", "staff-a", "ASSIGNED", { scheduledStart: new Date("2026-10-11T00:00:00Z") }),
    job("today-a", "org-a", "staff-a", "IN_PROGRESS", { scheduledStart: new Date("2026-10-13T01:00:00Z"), scheduledEnd: new Date("2026-10-13T04:00:00Z") }),
    job("done-a", "org-a", "staff-a", "COMPLETED", { completedAt: new Date("2026-09-30T16:00:00Z") }),
    job("done-today", "org-a", "staff-a", "COMPLETED", { completedAt: new Date("2026-10-13T01:00:00Z") }),
    job("previous-a", "org-a", "staff-a", "COMPLETED", { completedAt: new Date("2026-09-01T00:00:00Z") }),
    job("other-staff", "org-a", "other", "ASSIGNED"),
    job("done-other", "org-a", "other", "COMPLETED", { completedAt: new Date("2026-10-05T00:00:00Z") }),
    job("unassigned-a", "org-a", null, "ASSIGNED"),
    job("private-b", "org-b", "staff-a", "COMPLETED", { completedAt: new Date("2026-10-03T00:00:00Z") }),
    job("cancelled-a", "org-a", "staff-a", "CANCELLED", { scheduledEnd: new Date("2026-10-01T00:00:00Z") }),
  ];
  const req = (id: string, status: string, related: any[]) => ({ id, organizationId: "org-a", status, jobs: related,
    referenceNumber: id, title: id, priority: "NORMAL", customer: { name: "A", organizationId: "org-a" },
    serviceType: { organizationId: "org-a" }, createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: now });
  requests = [req("waiting", "PENDING", []), req("ready", "IN_PROGRESS", [jobs[2]]),
    req("cancelled-job", "IN_PROGRESS", [jobs[9]]), req("still-active", "IN_PROGRESS", [jobs[1]])];
  const invoice = (id: string, total: string, amountPaid: string, dueAt: string, org = "org-a", status = "PARTIALLY_PAID") => ({
    id, organizationId: org, invoiceNumber: id, customer: { name: org, organizationId: org },
    total: new Prisma.Decimal(total), amountPaid: new Prisma.Decimal(amountPaid), status,
    issuedAt: new Date("2026-10-02T00:00:00Z"), dueAt: new Date(dueAt),
  });
  invoices = [invoice("overdue", "100.10", "10.10", "2026-10-11T16:00:00Z"),
    invoice("due-today", "100.20", "30.10", "2026-10-12T16:00:00Z"),
    invoice("void", "9999.00", "0", "2026-10-01T00:00:00Z", "org-a", "VOID"),
    invoice("private-b", "9999.00", "0", "2026-10-01T00:00:00Z", "org-b")];
  payments = invoices.map((row, index) => ({ invoice: row, amount: new Prisma.Decimal(index < 2 ? row.amountPaid : "9999"),
    receivedAt: new Date("2026-10-10T00:00:00Z") }));
  customers = [{ organizationId: "org-a", deletedAt: null }, { organizationId: "org-a", deletedAt: now }, { organizationId: "org-b", deletedAt: null }];
}

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: any) => {
    if (key === "AND") return value.every((filter: any) => matches(row, filter));
    if (key === "OR") return value.some((filter: any) => matches(row, filter));
    const actual = row[key];
    if (value === null || typeof value !== "object") return actual === value;
    if (key === "jobs") return Object.entries(value).every(([quantifier, filter]) =>
      quantifier === "some" ? actual.some((item: any) => matches(item, filter)) : quantifier === "none"
        ? !actual.some((item: any) => matches(item, filter)) : actual.every((item: any) => matches(item, filter)));
    if ("in" in value) return value.in.includes(actual);
    if ("notIn" in value) return !value.notIn.includes(actual);
    if ("not" in value) return actual !== value.not;
    if ("gte" in value || "lt" in value) return actual !== null && actual !== undefined &&
      (!("gte" in value) || actual >= value.gte) && (!("lt" in value) || actual < value.lt);
    return actual != null && matches(actual, value);
  });
}
function project(row: any, select: any): any {
  return Object.fromEntries(Object.entries(select).map(([key, value]: any) =>
    [key, value === true || row[key] == null ? row[key] : project(row[key], value.select)]));
}
function model(rows: () => any[]) {
  return {
    count: jest.fn(async ({ where }: any) => rows().filter((row) => matches(row, where)).length),
    groupBy: jest.fn(async ({ where }: any) => {
      const filtered = rows().filter((row) => matches(row, where));
      return [...new Set(filtered.map((row) => row.status))].map((status) => ({ status, _count: { _all: filtered.filter((row) => row.status === status).length } }));
    }),
    findMany: jest.fn(async ({ where, select, take, orderBy }: any) => rows().filter((row) => matches(row, where))
      .sort((a, b) => {
        for (const order of orderBy) {
          const [field, direction] = Object.entries(order)[0];
          if (a[field] < b[field]) return direction === "asc" ? -1 : 1;
          if (a[field] > b[field]) return direction === "asc" ? 1 : -1;
        }
        return 0;
      }).slice(0, take).map((row) => project(row, select))),
    aggregate: jest.fn(async ({ where, _sum }: any) => {
      const filtered = rows().filter((row) => matches(row, where));
      return { _count: { _all: filtered.length }, _sum: Object.fromEntries(Object.keys(_sum).map((field) =>
        [field, filtered.reduce((sum, row) => sum.add(row[field]), new Prisma.Decimal(0))])) };
    }),
  };
}
const db = {
  user: { findUnique: jest.fn(async ({ where }: any) => sessions[where.id] ?? null) },
  job: model(() => jobs), serviceRequest: model(() => requests), invoice: model(() => invoices),
  payment: model(() => payments), customer: model(() => customers),
  $transaction: jest.fn(async (work: (client: any) => Promise<unknown>) => work(db)),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger: { error: jest.fn() } }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn() }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (sub: string) =>
  ({ sub, role: "Admin", organizationId: "org-b", permissions: Object.values(P) }) }));
const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { default: routes } = await import("@/modules/dashboard/dashboard.routes.js");
const app = express();
app.use(withRequestContext);
app.use("/dashboard", authenticate, routes);
const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message });
app.use(errors);
const get = (actor = "admin-a", query = "") => request(app).get("/dashboard" + query).set("Authorization", `Bearer ${actor}`);
beforeEach(() => { jest.clearAllMocks(); reset(); jest.useFakeTimers({ now, doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "performance"] }); });
afterEach(() => jest.useRealTimers());

describe("Dashboard authorization and tenant scope", () => {
  it("requires a live authenticated organization session and dashboard permission", async () => {
    expect((await request(app).get("/dashboard")).status).toBe(401);
    expect((await get("missing")).status).toBe(401);
    expect((await get("platform")).status).toBe(403);
    sessions["admin-a"].userPermissions = [{ isActive: false, permission: { id: P.DASHBOARD_READ, name: P.DASHBOARD_READ, organizationId: null } }];
    expect((await get()).status).toBe(403);
    expect(db.job.count).not.toHaveBeenCalled();
  });
  it("uses the current database role and organization despite forged token claims", async () => {
    const response = await get("staff-a");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.data).toMatchObject({ mode: "staff", jobs: { assigned: 1, inProgress: 1, completedThisMonth: 2, completedToday: 1, completedPreviousPeriod: 1, overdue: 1, scheduledToday: 1 }, requests: null, billing: null, customers: null });
    expect(response.body.data.jobs.queue.map((job: any) => job.id)).toEqual(["late-a", "today-a"]);
    for (const method of [db.job.count, db.job.groupBy, db.job.findMany]) {
      for (const [input] of method.mock.calls as any) expect(input.where).toMatchObject({ organizationId: "org-a", assignedStaffId: "staff-a" });
    }
    expect(db.payment.aggregate).not.toHaveBeenCalled();
  });
  it("isolates every admin summary, queue, and payment through the tenant invoice", async () => {
    const response = await get();
    expect(response.body.data).toMatchObject({ mode: "business", customers: 1, jobs: { completedThisMonth: 3, assigned: 3, unassigned: 1 },
      billing: { billedThisMonth: "200.30", collectedThisMonth: "40.20", outstanding: "160.10", overdueCount: 1, overdueBalance: "90.00", unpaidCount: 2 } });
    expect(response.body.data.billing.overdueInvoices.map((row: any) => row.id)).toEqual(["overdue"]);
    expect(JSON.stringify(response.body)).not.toMatch(/private-b|Customer-org-b|organizationId/);
    const other = await get("admin-b");
    expect(other.body.data.jobs.completedThisMonth).toBe(1);
    expect(other.body.data.customers).toBe(1);
    expect(db.payment.aggregate.mock.calls[0]).toEqual([expect.objectContaining({ where: expect.objectContaining({ invoice: expect.objectContaining({ organizationId: "org-a" }) }) })]);
  });
  it("hides revoked sections instead of querying them or returning zero", async () => {
    sessions["admin-a"].userPermissions = [P.JOB_READ, P.SERVICE_REQUEST_READ, P.INVOICE_READ, P.CUSTOMER_READ].map((name) =>
      ({ isActive: false, permission: { id: name, name, organizationId: null } }));
    expect((await get()).body.data).toMatchObject({ jobs: null, requests: null, billing: null, customers: null });
    expect(db.job.count).not.toHaveBeenCalled(); expect(db.invoice.aggregate).not.toHaveBeenCalled();
    expect(db.serviceRequest.count).not.toHaveBeenCalled(); expect(db.customer.count).not.toHaveBeenCalled();
  });
  it("changes to a personal view as soon as an administrator becomes staff", async () => {
    expect((await get()).body.data.mode).toBe("business");
    sessions["admin-a"].role.name = "Staff";
    expect((await get()).body.data).toMatchObject({ mode: "staff", jobs: { assigned: 0 }, billing: null });
    expect((await get("manager-a")).body.data.mode).toBe("business");
  });
  it("rejects attempts to choose a tenant, staff member, or mode via query parameters", async () => {
    for (const query of ["?organizationId=org-b", "?userId=other", "?mode=business"]) expect((await get("staff-a", query)).status).toBe(400);
    expect(db.job.count).not.toHaveBeenCalled();
  });
  it("does not reveal an assigned staff name after that person moves to another tenant", async () => {
    jobs[5].assignedStaff = { firstName: "PrivateForeignName", lastName: "Private", organizationId: "org-b" };
    const response = await get();
    expect(response.body.data.jobs.queue.find((job: any) => job.id === "other-staff").assignedStaff).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain("PrivateForeignName");
  });
  it("propagates database failures instead of presenting empty or successful metrics", async () => {
    db.job.groupBy.mockRejectedValueOnce(new Error("Database unavailable"));
    expect((await get()).status).toBe(500);
  });
});

describe("Dashboard business definitions", () => {
  it("counts requests as ready only when at least one job exists and every job is completed", async () => {
    const response = await get();
    expect(response.body.data.requests).toMatchObject({ waitingForAssignment: 2, readyToClose: 1 });
    expect(response.body.data.requests.completionQueue.map((row: any) => row.id)).toEqual(["ready"]);
  });
  it("counts billable jobs only after parent completion and only without an existing invoice", async () => {
    jobs[2].serviceRequestId = "open"; jobs[2].serviceRequest = { organizationId: "org-a", status: "IN_PROGRESS" };
    jobs[3].invoice = { id: "invoice" };
    expect((await get()).body.data.jobs.readyToInvoice).toBe(2); // previous month and the other staff member's completed jobs
  });
  it("keeps unscheduled work after scheduled work and excludes cancelled jobs", async () => {
    jobs.push({ ...jobs[0], id: "unscheduled", scheduledStart: null });
    const response = await get("staff-a");
    expect(response.body.data.jobs.queue.map((job: any) => job.id)).toEqual(["late-a", "today-a", "unscheduled"]);
    expect(response.body.data.jobs.unscheduled).toBe(1);
  });
  it("uses Manila month boundaries and completion timestamps, including midnight on day one", async () => {
    const response = await get("staff-a");
    expect(response.body.data.period.start).toBe("2026-09-30T16:00:00.000Z");
    expect(response.body.data.jobs.weeklyCompletions.map((week: any) => week.count)).toEqual([1, 1, 0, 0, 0]);
    jobs[2].completedAt = new Date("2026-09-30T15:59:59Z");
    expect((await get("staff-a")).body.data.jobs.completedThisMonth).toBe(1);
  });
  it("returns actual zero totals and empty queues for an organization with no activity", async () => {
    jobs = []; requests = []; invoices = []; payments = []; customers = [];
    expect((await get()).body.data).toMatchObject({ customers: 0, jobs: { assigned: 0, queue: [], completedThisMonth: 0 },
      billing: { outstanding: "0.00", collectedThisMonth: "0.00", overdueInvoices: [] } });
  });
});

describe("Reporting periods", () => {
  it("handles the year boundary independently of the host timezone", () => {
    const periods = dashboardPeriods(new Date("2026-12-31T16:30:00Z"));
    expect(periods.label).toBe("January 2027");
    expect(periods.monthStart.toISOString()).toBe("2026-12-31T16:00:00.000Z");
    expect(periods.previousStart.toISOString()).toBe("2026-11-30T16:00:00.000Z");
    expect(periods.previousEnd.toISOString()).toBe("2026-11-30T16:30:00.000Z");
  });
  it("caps comparisons for shorter months and supports leap years", () => {
    const periods = dashboardPeriods(new Date("2026-03-31T02:00:00Z"));
    expect(periods.previousEnd).toEqual(periods.monthStart);
    expect(dashboardPeriods(new Date("2028-02-29T02:00:00Z")).weeks.at(-1)?.label).toBe("29-29");
    expect(dashboardPeriods(new Date("2026-02-20T02:00:00Z")).weeks.map((week) => week.label)).toEqual(["1-7", "8-14", "15-21", "22-28"]);
  });
});
