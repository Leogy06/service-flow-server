import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";

type Actor = { id: string; firstName: string; lastName: string; organizationId: string };
type LogRow = {
  id: string; action: string; entity: string; entityId: string; scope: string;
  organizationId: string | null; createdAt: Date; actor: Actor | null;
  metadata: { password: string }; ipAddress: string; userAgent: string;
};
let logs: LogRow[];
let sessions: Record<string, any>;

function session(id: string, role: string, organizationId: string | null) {
  return {
    id, email: id + "@example.com", firstName: "Test", lastName: "User",
    status: "ACTIVE", deletedAt: null, organizationId,
    platformRole: id === "platform" ? "SYSTEM_ADMIN" : "NONE", securityStatus: "ACTIVE", sessionVersion: 0,
    organization: organizationId ? { id: organizationId, slug: organizationId, status: "ACTIVE", billingEnabled: false } : null,
    role: { id: "role-" + id, name: role, organizationId, deletedAt: null,
      permissions: Object.values(PERMISSIONS).map((name) => ({ permission: { id: name, name, organizationId: null } })),
    },
    userPermissions: [],
  };
}

function resetData() {
  sessions = {
    "admin-a": session("admin-a", "Admin", "org-a"),
    "admin-b": session("admin-b", "TENANT_ADMIN", "org-b"),
    "staff-a": session("staff-a", "Staff", "org-a"),
    "manager-a": session("manager-a", "Manager", "org-a"),
    "platform": session("platform", "PLATFORM_ADMIN", null),
    "no-org": session("no-org", "Admin", null),
  };
  const actor = (organizationId: string): Actor => ({ id: "actor-" + organizationId, firstName: "Alice", lastName: "Able", organizationId });
  logs = [
    { id: "a-1", organizationId: "org-a", action: "create.customer.success", entity: "Customer", entityId: "customer-a", actor: actor("org-a") },
    { id: "a-2", organizationId: "org-a", action: "update.job.success", entity: "Job", entityId: "job-a", actor: actor("org-a") },
    { id: "a-3", organizationId: "org-a", action: "seed.admin.role.permissions.success", entity: "Role", entityId: "role-a", actor: null },
    { id: "b-1", organizationId: "org-b", action: "delete.customer.success", entity: "Customer", entityId: "private-b", actor: actor("org-b") },
    { id: "global", organizationId: null, action: "create.user.success", entity: "User", entityId: "platform-user", actor: null },
  ].map((row, index) => ({ ...row, createdAt: new Date(Date.UTC(2026, 9, index + 1)),
    scope: "TENANT", metadata: { password: "must-never-be-returned" }, ipAddress: "127.0.0.1", userAgent: "private user agent",
  }));
}

function matches(row: Record<string, any>, where: any): boolean {
  return Object.entries(where).every(([key, condition]: any) => {
    if (key === "AND") return condition.every((filter: any) => matches(row, filter));
    if (key === "OR") return condition.some((filter: any) => matches(row, filter));
    if (key === "actor") return !!row.actor && matches(row.actor, condition.is);
    if (condition && typeof condition === "object" && "contains" in condition) {
      return String(row[key]).toLowerCase().includes(condition.contains.toLowerCase());
    }
    return row[key] === condition;
  });
}

function project(row: Record<string, any>, select: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [
    key, value === true || row[key] === null ? row[key] : project(row[key], value.select),
  ]));
}

const db = {
  user: { findUnique: jest.fn(async ({ where }: any) => sessions[where.id] ?? null) },
  auditLog: {
    count: jest.fn(async ({ where }: any) => logs.filter((row) => matches(row, where)).length),
    findMany: jest.fn(async ({ where, orderBy, skip, take, select }: any) => logs
      .filter((row) => matches(row, where))
      .sort((a, b) => (orderBy[0].createdAt === "asc" ? 1 : -1) *
        (a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)))
      .slice(skip, skip + take).map((row) => project(row, select))),
    groupBy: jest.fn(async ({ by: [field], where }: { by: ("action" | "entity")[]; where: { organizationId: string } }) =>
      [...new Set(logs.filter((row) => matches(row, where)).map((row) => row[field]))]
        .sort().map((value) => ({ [field]: value }))),
    create: jest.fn(),
  },
  $transaction: jest.fn(async (work: (db: any) => Promise<unknown>) => work(db)),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger: { error: jest.fn() } }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn() }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({
  // Forged token claims must never override the current database session.
  verifyAccessToken: (sub: string) => ({ sub, role: "Admin", organizationId: "org-b", permissions: Object.values(PERMISSIONS) }),
}));

const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { default: auditRoutes } = await import("@/modules/audit/audit.routes.js");
const { auditService } = await import("@/modules/audit/audit.service.js");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/audit-logs", authenticate, auditRoutes);
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(error.statusCode ?? 500).json({ error: error.message });
};
app.use(errors);
const get = (query = "", actor = "admin-a") => request(app).get("/audit-logs" + query).set("Authorization", "Bearer " + actor);
const ids = (response: any) => response.body.data.logs.map((row: LogRow) => row.id);
beforeEach(() => { jest.clearAllMocks(); resetData(); });

describe("Read-only tenant audit logs", () => {
  it("scopes both rows and totals to the database session organization", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(ids(response)).toEqual(["a-3", "a-2", "a-1"]);
    expect(response.body.data.pagination).toMatchObject({ total: 3, page: 1, pageSize: 10 });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(ids(await get("", "admin-b"))).toEqual(["b-1"]);
  });

  it.each(["staff-a", "manager-a", "platform", "no-org"])("denies %s even with administrative permissions", async (actor) => {
    expect((await get("", actor)).status).toBe(actor === "no-org" ? 401 : 403);
    expect(db.auditLog.count).not.toHaveBeenCalled();
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
    expect(db.auditLog.groupBy).not.toHaveBeenCalled();
  });

  it("requires authentication and rejects missing or inactive users", async () => {
    expect((await request(app).get("/audit-logs")).status).toBe(401);
    expect((await get("", "missing")).status).toBe(401);
    sessions["admin-a"].status = "INACTIVE";
    expect((await get()).status).toBe(401);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it.each(["user", "role", "organization"])("rejects invalid %s membership from the current database state", async (change) => {
    if (change === "user") sessions["admin-a"].deletedAt = new Date();
    if (change === "role") sessions["admin-a"].role.deletedAt = new Date();
    if (change === "organization") sessions["admin-a"].role.organizationId = "org-b";
    expect((await get()).status).toBe(401);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("revokes access after a role change despite older admin token claims", async () => {
    expect((await get()).status).toBe(200);
    sessions["admin-a"].role.name = "Staff";
    expect((await get()).status).toBe(403);
    expect(db.auditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns only the selected activity fields and same-tenant actor names", async () => {
    const response = await get();
    expect(response.body.data.logs[2]).toEqual({
      id: "a-1", action: "create.customer.success", entity: "Customer", entityId: "customer-a",
      createdAt: "2026-10-01T00:00:00.000Z", actor: { id: "actor-org-a", firstName: "Alice", lastName: "Able" },
    });
    expect(response.body.data.logs[0].actor).toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(/must-never-be-returned|ipAddress|userAgent|organizationId/);
  });

  it("withholds actor details and actor search when a historical actor moves to another tenant", async () => {
    logs[0].actor!.organizationId = "org-b";
    logs[0].actor!.firstName = "ForeignName";
    expect((await get()).body.data.logs[2].actor).toBeNull();
    expect(ids(await get("?search=ForeignName"))).toEqual([]);
  });

  it.each([
    ["create.customer", ["a-1"]], ["Job", ["a-2"]], ["customer-a", ["a-1"]],
    ["Able Alice", ["a-2", "a-1"]], ["private-b", []], ["platform-user", []],
  ])("searches %s within the current tenant", async (search, expected) => {
    expect(ids(await get("?search=" + encodeURIComponent(search as string)))).toEqual(expected);
  });

  it("paginates, clamps stale pages and supports both timestamp directions", async () => {
    expect(ids(await get("?page=2&pageSize=1"))).toEqual(["a-2"]);
    const last = await get("?page=999&pageSize=2");
    expect(ids(last)).toEqual(["a-1"]);
    expect(last.body.data.pagination).toMatchObject({ page: 2, totalPages: 2, hasNextPage: false, hasPreviousPage: true });
    expect(ids(await get("?sortOrder=asc"))).toEqual(["a-1", "a-2", "a-3"]);
    const empty = await get("?search=missing&page=99");
    expect(empty.body.data.pagination).toMatchObject({ page: 1, total: 0, totalPages: 1 });
  });

  it("uses record IDs to keep pagination stable for matching timestamps", async () => {
    logs[0].createdAt = logs[1].createdAt;
    expect(ids(await get("?page=2&pageSize=1"))).toEqual(["a-2"]);
    expect(ids(await get("?page=3&pageSize=1"))).toEqual(["a-1"]);
  });

  it("returns unique filter choices from the tenant's full history, independent of page and active filters", async () => {
    logs.push({ ...logs[0], id: "a-duplicate" });
    const response = await get("?pageSize=1&action=update.job.success&entity=Job&search=Alice");
    expect(response.status).toBe(200);
    expect(response.body.data.filters).toEqual({
      actions: ["create.customer.success", "seed.admin.role.permissions.success", "update.job.success"],
      entities: ["Customer", "Job", "Role"],
    });
    expect((await get("", "admin-b")).body.data.filters).toEqual({ actions: ["delete.customer.success"], entities: ["Customer"] });
    expect((await get("?search=missing")).body.data.filters).toEqual(response.body.data.filters);
  });

  it.each([
    ["action=create.customer.success", ["a-1"]],
    ["entity=Job", ["a-2"]],
    ["action=update.job.success&entity=Job&search=Able", ["a-2"]],
    ["action=update.job.success&entity=Customer", []],
    ["action=delete.customer.success", []],
    ["action=update", []],
    ["entity=Unknown", []],
  ])("filters actions and record types server-side for %s", async (query, expected) => {
    const response = await get("?" + query);
    expect(response.status).toBe(200);
    expect(ids(response)).toEqual(expected);
    expect(response.body.data.pagination.total).toBe(expected.length);
  });

  it("keeps filter totals and pagination scoped and respects timestamp sorting", async () => {
    logs[0].action = "update.job.success";
    logs[0].entity = "Job";
    const response = await get("?action=update.job.success&entity=Job&pageSize=1&page=2&sortOrder=asc");
    expect(ids(response)).toEqual(["a-2"]);
    expect(response.body.data.pagination).toMatchObject({ page: 2, total: 2, totalPages: 2 });
  });

  it.each([
    "organizationId=org-b", "actorId=actor-org-b", "page=0", "page=1.5", "page=1000001",
    "pageSize=0", "pageSize=101", "pageSize=1.5", "sortOrder=invalid", "sortBy=password", "search=" + "x".repeat(121),
    "action=", "entity=", "action=" + "x".repeat(192), "entity=" + "x".repeat(192),
    "action=one&action=two", "entity=one&entity=two",
  ])("rejects unsupported or invalid input %s", async (query) => {
    expect((await get("?" + query)).status).toBe(400);
    expect(db.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("exposes no mutation or individual-record endpoints", async () => {
    for (const method of ["post", "patch", "delete"] as const) {
      expect((await request(app)[method]("/audit-logs").set("Authorization", "Bearer admin-a").send({})).status).toBe(404);
    }
    expect((await get("/b-1")).status).toBe(404);
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("propagates database failures without returning successful results", async () => {
    db.auditLog.count.mockRejectedValueOnce(new Error("Unavailable"));
    expect((await get()).status).toBe(500);
  });

  it("does not return successful results when filter choices cannot be loaded", async () => {
    db.auditLog.groupBy.mockRejectedValueOnce(new Error("Unavailable"));
    expect((await get()).status).toBe(500);
  });

  it("rejects direct service use without authenticated tenant context", async () => {
    await expect(auditService.list({ page: 1, pageSize: 10, search: "", sortOrder: "desc" }))
      .rejects.toMatchObject({ statusCode: 403 });
  });
  it("does not expose platform security audit rows or filter choices through a tenant organization relation", async () => {
    logs.push({ ...logs[0], id: "platform-security", scope: "PLATFORM", action: "user.security.changed", entity: "PlatformSecurity", metadata: { password: "private platform audit" } });
    const response = await get();
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("platform-security");
    expect(JSON.stringify(response.body)).not.toContain("PlatformSecurity");
    expect(response.body.data.pagination.total).toBe(3);
  });
});
