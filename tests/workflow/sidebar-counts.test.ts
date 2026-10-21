import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import request from "supertest";
import { PERMISSIONS as P } from "../../src/constants/permission.constants.js";

// Exercise the real auth, routes, services and cache with isolated adapters.
type Row = { organizationId: string; status: string };
let requests: Row[], jobs: Row[], invoices: Row[];
const store = new Map<string, string>();
const redis = {
  get: jest.fn(async (key: string) => store.get(key) ?? null),
  set: jest.fn(async (key: string, value: string) => { store.set(key, value); return "OK"; }),
  incr: jest.fn(async (key: string) => {
    const version = Number(store.get(key) ?? 0) + 1;
    store.set(key, String(version));
    return version;
  }),
  scan: jest.fn(async (_cursor: string, _match: string, pattern: string) =>
    ["0", [...store.keys()].filter((key) => key.startsWith(pattern.slice(0, -1)))]),
  del: jest.fn(async (...keys: string[]) => { keys.forEach((key) => store.delete(key)); return keys.length; }),
};
const readPermissions = [P.SERVICE_REQUEST_READ, P.JOB_READ, P.INVOICE_READ];
const permission = (name: string) => ({ id: name, name, organizationId: null });
function session(id: string, organizationId: string | null) {
  return {
    id, email: `${id}@example.invalid`, firstName: id, lastName: "Member",
    status: "ACTIVE", deletedAt: null, securityStatus: "ACTIVE", sessionVersion: 0,
    platformRole: organizationId ? "NONE" : "SYSTEM_ADMIN", organizationId,
    organization: organizationId ? { id: organizationId, slug: organizationId, status: "ACTIVE", billingEnabled: false } : null,
    role: { id: `role-${id}`, name: "Staff", organizationId, deletedAt: null,
      permissions: readPermissions.map((name) => ({ permission: permission(name) })) },
    userPermissions: [] as { isActive: boolean; permission: ReturnType<typeof permission> }[],
  };
}
let sessions: Record<string, ReturnType<typeof session>>;
function model(rows: () => Row[]) {
  return {
    groupBy: jest.fn(async ({ where }: { where: { organizationId: string } }) => {
      const scoped = rows().filter((row) => row.organizationId === where.organizationId);
      return [...new Set(scoped.map((row) => row.status))].map((status) => ({
        status, _count: { _all: scoped.filter((row) => row.status === status).length },
      }));
    }),
    findMany: jest.fn(), count: jest.fn(),
  };
}
const db = {
  user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => sessions[where.id] ?? null) },
  serviceRequest: model(() => requests), job: model(() => jobs), invoice: model(() => invoices),
  $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(db)),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis, redisReady: async () => {} }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger: { error: jest.fn() } }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {} }));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => ({
  writeLimmiter: ((_req, _res, next) => next()) as RequestHandler,
}));
jest.unstable_mockModule("@/utils/tokens.js", () => ({
  // Deliberately forged tenant/permission claims must not override loaded account state.
  verifyAccessToken: (sub: string) => ({ sub, organizationId: "org-b", permissions: readPermissions }),
}));
const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { requestContext } = await import("@/lib/requestContext.js");
const { invalidateModuleCache } = await import("@/utils/module-cache.js");
const { default: requestRoutes } = await import("@/modules/service-request/service-request.routes.js");
const { default: jobRoutes } = await import("@/modules/job/job.routes.js");
const { default: invoiceRoutes } = await import("@/modules/invoice/invoice.routes.js");
const { serviceRequestService } = await import("@/modules/service-request/service-request.service.js");
const { jobService } = await import("@/modules/job/job.service.js");
const { invoiceService } = await import("@/modules/invoice/invoice.service.js");
const app = express();
app.use(express.json(), withRequestContext);
// API limiter integration is tested at the authenticated router mount separately.
app.use("/service-requests", authenticate, requestRoutes);
app.use("/jobs", authenticate, jobRoutes);
app.use("/invoices", authenticate, invoiceRoutes);
const errors: ErrorRequestHandler = (error, _req, res, _next) =>
  res.status(error.statusCode ?? 500).json({ error: error.message });
app.use(errors);
const get = (path: string, actor = "staff-a") => request(app).get(path).auth(actor, { type: "bearer" });
const rows = (organizationId: string, statuses: string[]) => statuses.map((status) => ({ organizationId, status }));
beforeEach(() => {
  store.clear(); jest.clearAllMocks();
  sessions = { "staff-a": session("staff-a", "org-a"), "staff-b": session("staff-b", "org-b"), platform: session("platform", null) };
  requests = [...rows("org-a", ["PENDING", "PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]), ...rows("org-b", ["PENDING"])];
  jobs = [...rows("org-a", ["ASSIGNED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]), ...rows("org-b", ["IN_PROGRESS", "IN_PROGRESS"])];
  invoices = [...rows("org-a", ["UNPAID", "UNPAID", "PARTIALLY_PAID", "PAID", "VOID"]), ...rows("org-b", ["UNPAID"])];
});
const cases = [
  {
    path: "/service-requests/counts", permission: P.SERVICE_REQUEST_READ, module: "serviceRequests" as const,
    model: db.serviceRequest, count: serviceRequestService.counts,
    expected: { pending: 2, inProgress: 1, byStatus: { PENDING: 2, IN_PROGRESS: 1, COMPLETED: 1, CANCELLED: 1 }, total: 5 },
    foreign: { pending: 1, inProgress: 0, byStatus: { PENDING: 1, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 }, total: 1 },
    empty: { pending: 0, inProgress: 0, byStatus: { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 }, total: 0 },
    add: () => requests.push({ organizationId: "org-a", status: "PENDING" }), key: "pending",
  },
  {
    path: "/jobs/counts", permission: P.JOB_READ, module: "jobs" as const,
    model: db.job, count: jobService.counts,
    expected: { assigned: 2, inProgress: 1 }, foreign: { assigned: 0, inProgress: 2 },
    empty: { assigned: 0, inProgress: 0 },
    add: () => jobs.push({ organizationId: "org-a", status: "ASSIGNED" }), key: "assigned",
  },
  {
    path: "/invoices/counts", permission: P.INVOICE_READ, module: "invoices" as const,
    model: db.invoice, count: invoiceService.counts,
    expected: { unpaid: 2, partiallyPaid: 1 }, foreign: { unpaid: 1, partiallyPaid: 0 },
    empty: { unpaid: 0, partiallyPaid: 0 },
    add: () => invoices.push({ organizationId: "org-a", status: "UNPAID" }), key: "unpaid",
  },
];

describe.each(cases)("$path", (resource) => {
  test("requires authentication and the matching read permission before database or cache access", async () => {
    expect((await request(app).get(resource.path)).status).toBe(401);
    expect((await get(resource.path, "missing")).status).toBe(401);
    expect((await get(resource.path, "platform")).status).toBe(403);
    sessions["staff-a"]!.userPermissions.push({ isActive: false, permission: permission(resource.permission) });
    expect((await get(resource.path)).status).toBe(403);
    expect(resource.model.groupBy).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  test("returns the compatible tenant-wide shape from one aggregate without loading list rows", async () => {
    const response = await get(resource.path).set("X-Organization-Id", "org-b").send({ organizationId: "org-b" });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(resource.expected);
    expect(resource.model.groupBy).toHaveBeenCalledTimes(1);
    expect(resource.model.groupBy).toHaveBeenCalledWith({
      by: ["status"], where: { organizationId: "org-a" }, _count: { _all: true },
    });
    expect(resource.model.findMany).not.toHaveBeenCalled();
    expect(resource.model.count).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });

  test.each(["organizationId=org-b", "status=COMPLETED", "page=1", "mine=true"])("rejects unsupported query selectors: %s", async (query) => {
    expect((await get(`${resource.path}?${query}`)).status).toBe(400);
    expect(resource.model.groupBy).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  test("isolates warm caches across tenants and rechecks denied permissions on every read", async () => {
    expect((await get(resource.path)).body.data).toEqual(resource.expected);
    expect((await get(resource.path, "staff-b")).body.data).toEqual(resource.foreign);
    expect((await get(resource.path)).body.data).toEqual(resource.expected);
    expect(resource.model.groupBy).toHaveBeenCalledTimes(2);
    sessions["staff-a"]!.userPermissions.push({ isActive: false, permission: permission(resource.permission) });
    expect((await get(resource.path)).status).toBe(403);
    expect(resource.model.groupBy).toHaveBeenCalledTimes(2);
  });

  test("returns explicit zero counts for an empty tenant", async () => {
    sessions["staff-a"] = session("staff-a", "org-empty");
    expect((await get(resource.path)).body.data).toEqual(resource.empty);
  });

  test("refreshes the count after existing module invalidation without evicting another tenant", async () => {
    await get(resource.path);
    await get(resource.path, "staff-b");
    resource.add();
    expect((await get(resource.path)).body.data).toEqual(resource.expected);
    await requestContext.run({ requestId: "count-invalidation", organizationId: "org-a" }, () => invalidateModuleCache(resource.module));
    expect((await get(resource.path, "staff-b")).body.data).toEqual(resource.foreign);
    expect(resource.model.groupBy).toHaveBeenCalledTimes(2);
    const updated = await get(resource.path);
    expect(updated.body.data[resource.key]).toBe(3);
    if (resource.module === "serviceRequests") {
      expect(updated.body.data.total).toBe(6);
      expect(updated.body.data.byStatus.PENDING).toBe(3);
    }
    expect(resource.model.groupBy).toHaveBeenCalledTimes(3);
  });

  test("requires a trusted tenant even when invoked directly", async () => {
    await expect(resource.count()).rejects.toMatchObject({ statusCode: 403 });
    expect(resource.model.groupBy).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  test("propagates aggregate failures without caching a false success", async () => {
    resource.model.groupBy.mockRejectedValueOnce(new Error("Aggregate unavailable"));
    expect((await get(resource.path)).status).toBe(500);
    expect(redis.set).not.toHaveBeenCalled();
    expect((await get(resource.path)).body.data).toEqual(resource.expected);
  });
});
