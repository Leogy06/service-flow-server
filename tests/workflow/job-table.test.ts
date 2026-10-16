import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import request from "supertest";
import { PERMISSIONS as P } from "../../src/constants/permission.constants.js";

let sessions: Record<string, any>;
let jobs: any[];
function session(id: string, organizationId: string | null) {
  return { id, email: `${id}@example.com`, firstName: id, lastName: "User", status: "ACTIVE", deletedAt: null,
    platformRole: id === "platform" ? "SYSTEM_ADMIN" : "NONE", securityStatus: "ACTIVE", sessionVersion: 0,
    organizationId, organization: organizationId ? { id: organizationId, slug: organizationId, status: "ACTIVE", billingEnabled: false } : null,
    role: { id: `role-${id}`, name: "Staff", organizationId, deletedAt: null,
      permissions: [{ permission: { id: P.JOB_READ, name: P.JOB_READ, organizationId: null } }] }, userPermissions: [] };
}
function reset() {
  sessions = { "staff-a": session("staff-a", "org-a"), "staff-b": session("staff-b", "org-b"), platform: session("platform", null) };
  const job = (id: string, organizationId: string, status: string, staffId: string | null, customerId: string, serviceTypeId: string, extra: any = {}) => ({
    id, organizationId, status, assignedStaffId: staffId, customerId, serviceTypeId, referenceNumber: id,
    customer: { id: customerId, organizationId, name: customerId },
    serviceType: { id: serviceTypeId, organizationId, name: serviceTypeId, basePrice: "10.00" },
    assignedStaff: staffId ? { id: staffId, organizationId, firstName: staffId, lastName: "User" } : null,
    serviceRequestId: "request-a", serviceRequest: { id: "request-a", organizationId, referenceNumber: "REQ-a", status: "COMPLETED" },
    invoice: null, createdAt: new Date("2026-10-01"), internalNotes: "private notes", ...extra,
  });
  jobs = [
    job("a-1", "org-a", "ASSIGNED", "staff-a", "customer-1", "service-1"),
    job("a-2", "org-a", "IN_PROGRESS", "staff-a", "customer-2", "service-2"),
    job("a-3", "org-a", "COMPLETED", "other-a", "customer-1", "service-1"),
    job("a-4", "org-a", "CANCELLED", null, "customer-2", "service-1"),
    job("a-5", "org-a", "COMPLETED", "staff-a", "customer-2", "service-2", { invoice: { id: "invoice-a" } }),
    job("a-6", "org-a", "COMPLETED", "staff-a", "customer-2", "service-2", { serviceRequestId: "open-request", serviceRequest: { organizationId: "org-a", status: "IN_PROGRESS" } }),
    job("b-1", "org-b", "COMPLETED", "staff-b", "private-customer", "private-service"),
  ];
}
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: any) => {
    if (value === undefined) return true;
    if (key === "AND") return value.every((condition: any) => matches(row, condition));
    if (key === "OR") return value.some((condition: any) => matches(row, condition));
    if (value === null || typeof value !== "object") return row[key] === value;
    if ("contains" in value) return String(row[key]).toLowerCase().includes(value.contains.toLowerCase());
    if ("some" in value) return row[key].some((related: any) => matches(related, value.some));
    return row[key] != null && matches(row[key], value);
  });
}
function project(row: any, select: any): any {
  return Object.fromEntries(Object.entries(select).map(([key, value]: any) => [
    key, value === true || row[key] == null ? row[key] : project(row[key], value.select),
  ]));
}
function choices(field: string) {
  const ids = [...new Set(jobs.map((job) => job[field]?.id).filter(Boolean))];
  return ids.map((id) => ({ ...jobs.find((job) => job[field]?.id === id)[field], jobs: jobs.filter((job) => job[field]?.id === id) }));
}
function choiceModel(field: string) {
  return { findMany: jest.fn(async ({ where, select }: any) => choices(field).filter((row) => matches(row, where))
    .sort((a, b) => a.id.localeCompare(b.id)).map((row) => project(row, select))) };
}
const db = {
  user: { ...choiceModel("assignedStaff"), findUnique: jest.fn(async ({ where }: any) => sessions[where.id] ?? null) },
  customer: choiceModel("customer"), serviceType: choiceModel("serviceType"),
  job: {
    count: jest.fn(async ({ where }: any) => jobs.filter((row) => matches(row, where)).length),
    groupBy: jest.fn(async ({ where }: any) => {
      const rows = jobs.filter((row) => matches(row, where));
      return [...new Set(rows.map((row) => row.status))].map((status) => ({ status, _count: { _all: rows.filter((row) => row.status === status).length } }));
    }),
    findMany: jest.fn(async ({ where, select, skip, take, orderBy }: any) => jobs.filter((row) => matches(row, where))
      .sort((a, b) => (a.createdAt - b.createdAt) * (orderBy[0].createdAt === "asc" ? 1 : -1) || a.id.localeCompare(b.id))
      .slice(skip, skip + take).map((row) => project(row, select))),
  },
  $transaction: jest.fn(async (work: (client: any) => Promise<unknown>) => work(db)),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {} }));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => ({ writeLimmiter: ((_req, _res, next) => next()) as RequestHandler }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (sub: string) => ({ sub, organizationId: "org-b", permissions: Object.values(P) }) }));
const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { default: routes } = await import("@/modules/job/job.routes.js");
const { jobService } = await import("@/modules/job/job.service.js");
const app = express();
app.use(withRequestContext);
app.use("/jobs", authenticate, routes);
const errors: ErrorRequestHandler = (error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message });
app.use(errors);
const get = (path = "", actor = "staff-a") => request(app).get("/jobs" + path).set("Authorization", `Bearer ${actor}`);
const ids = (response: any) => response.body.data.jobs.map((job: any) => job.id);
beforeEach(() => { jest.clearAllMocks(); reset(); });

describe("Job table filters and counts", () => {
  it.each(["", "/filters"])("requires authentication, a tenant and job:read for %s", async (path) => {
    expect((await request(app).get("/jobs" + path)).status).toBe(401);
    expect((await get(path, "missing")).status).toBe(401);
    expect((await get(path, "platform")).status).toBe(403);
    sessions["staff-a"].userPermissions = [{ isActive: false, permission: { id: P.JOB_READ, name: P.JOB_READ, organizationId: null } }];
    expect((await get(path)).status).toBe(403);
    expect(db.job.findMany).not.toHaveBeenCalled();
    expect(db.job.groupBy).not.toHaveBeenCalled();
  });
  it("returns tenant-wide choices and counts to read-only staff without exposing private fields", async () => {
    const response = await get("/filters");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      counts: { total: 6, byStatus: { ASSIGNED: 1, IN_PROGRESS: 1, COMPLETED: 3, CANCELLED: 1 } },
      filters: { customers: [{ id: "customer-1", name: "customer-1" }, { id: "customer-2", name: "customer-2" }],
        serviceTypes: [{ id: "service-1", name: "service-1" }, { id: "service-2", name: "service-2" }],
        staff: [{ id: "other-a", firstName: "other-a", lastName: "User" }, { id: "staff-a", firstName: "staff-a", lastName: "User" }], hasUnassigned: true },
    });
    expect(JSON.stringify(response.body)).not.toMatch(/private-|organizationId|internalNotes/);
    const other = await get("/filters", "staff-b");
    expect(other.body.data.counts).toEqual({ total: 1, byStatus: { ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 1, CANCELLED: 0 } });
    expect(other.body.data.filters.customers).toEqual([{ id: "private-customer", name: "private-customer" }]);
  });
  it.each([
    ["customerId=customer-1", ["a-1", "a-3"]], ["serviceTypeId=service-2", ["a-2", "a-5", "a-6"]],
    ["assignedStaffId=other-a", ["a-3"]], ["assignedStaffId=unassigned", ["a-4"]],
    ["customerId=customer-1&serviceTypeId=service-1&assignedStaffId=other-a&status=COMPLETED&search=a-3", ["a-3"]],
    ["customerId=private-customer", []], ["serviceTypeId=private-service", []], ["assignedStaffId=staff-b", []],
    ["mine=true&assignedStaffId=other-a", []], ["mine=true&assignedStaffId=unassigned", []],
    ["mine=true&assignedStaffId=staff-a&status=IN_PROGRESS", ["a-2"]],
  ])("applies intersecting tenant-scoped filters for %s", async (query, expected) => {
    const response = await get("?" + query);
    expect(response.status).toBe(200);
    expect(ids(response)).toEqual(expected);
    expect(response.body.data.pagination.total).toBe(expected.length);
  });
  it("uses filtered totals for pagination, including stale and empty pages", async () => {
    const response = await get("?customerId=customer-1&page=2&pageSize=1");
    expect(ids(response)).toEqual(["a-3"]);
    expect(response.body.data.pagination).toMatchObject({ page: 2, total: 2, totalPages: 2 });
    expect((await get("?customerId=customer-1&page=99&pageSize=1")).body.data.pagination.page).toBe(2);
    expect((await get("?customerId=private-customer&page=99")).body.data.pagination).toMatchObject({ page: 1, total: 0 });
  });
  it("keeps my-jobs, request and billable scopes consistent between counts and rows", async () => {
    const mine = await get("/filters?mine=true");
    expect(mine.body.data.counts.total).toBe(4);
    expect(mine.body.data.filters.staff.map((row: any) => row.id)).toEqual(["staff-a"]);
    expect(mine.body.data.filters.hasUnassigned).toBe(false);
    const requestScope = await get("/filters?serviceRequestId=open-request");
    expect(requestScope.body.data.counts.total).toBe(1);
    expect((await get("/filters?serviceRequestId=foreign-request")).body.data.counts.total).toBe(0);
    const billable = await get("/filters?billable=true");
    expect(billable.body.data.counts).toEqual({ total: 1, byStatus: { ASSIGNED: 0, IN_PROGRESS: 0, COMPLETED: 1, CANCELLED: 0 } });
    expect(ids(await get("?billable=true&status=ASSIGNED"))).toEqual(["a-3"]);
    expect(ids(await get("?billable=true&assignedStaffId=staff-a"))).toEqual([]);
    expect((await get("/filters?billable=true&mine=true")).body.data.counts.total).toBe(0);
  });
  it("ignores client organization claims for rows and rejects them for filter metadata", async () => {
    expect(ids(await get("?organizationId=org-b&customerId=private-customer"))).toEqual([]);
    expect((await get("/filters?organizationId=org-b")).status).toBe(400);
  });
  it.each(["customerId=", "serviceTypeId=", "assignedStaffId=", "customerId=one&customerId=two", "assignedStaffId=" + "x".repeat(65)])("rejects invalid column filter %s", async (query) => {
    expect((await get("?" + query)).status).toBe(400);
    expect(db.job.findMany).not.toHaveBeenCalled();
  });
  it("returns errors when count, list or metadata queries fail", async () => {
    db.job.count.mockRejectedValueOnce(new Error("Unavailable"));
    expect((await get()).status).toBe(500);
    db.job.findMany.mockRejectedValueOnce(new Error("Unavailable"));
    expect((await get()).status).toBe(500);
    db.customer.findMany.mockRejectedValueOnce(new Error("Unavailable"));
    expect((await get("/filters")).status).toBe(500);
  });
  it("requires trusted tenant context for direct metadata access", async () => {
    await expect(jobService.filters({ mine: "false", billable: "false" })).rejects.toMatchObject({ statusCode: 403 });
  });
});
