import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";

type CustomerRow = {
  id: string; name: string; email: string; phoneNumber: string;
  address: string | null; notes: string | null; organizationId: string;
  createdAt: Date; updatedAt: Date; deletedAt: Date | null;
};
let customers: CustomerRow[];
let denied: string[];
let failAudit = false;
let demoOrganization = false;
const record = jest.fn(async (_event: unknown) => {});
const invalidateCache = jest.fn(async (_key: string) => {});
const cacheKeys: string[] = [];

function resetData() {
  denied = [];
  cacheKeys.length = 0;
  customers = [
    { id: "alice-a", name: "Alice Able", address: "Manila", notes: "Morning visits", organizationId: "org-a" },
    { id: "bob-a", name: "Bob Baker", address: null, notes: null, organizationId: "org-a" },
    { id: "carol-a", name: "Carol Cole", address: "", notes: "", organizationId: "org-a" },
    { id: "deleted-a", name: "Deleted Customer", address: null, notes: "Private notes", organizationId: "org-a" },
    { id: "alice-b", name: "Alice Private", address: null, notes: "Private B notes", organizationId: "org-b" },
  ].map((row, i) => ({ ...row, email: row.id + "@example.com", phoneNumber: "0917123456" + i,
    createdAt: new Date(Date.UTC(2026, 9, i + 1)), updatedAt: new Date(Date.UTC(2026, 9, i + 1)),
    deletedAt: row.id === "deleted-a" ? new Date() : null,
  }));
}

function matches(row: CustomerRow, where: any): boolean {
  return Object.entries(where).every(([field, condition]: any) => {
    if (field === "AND") return condition.every((item: any) => matches(row, item));
    if (field === "OR") return condition.some((item: any) => matches(row, item));
    const value = row[field as keyof CustomerRow];
    if (condition && typeof condition === "object") {
      if ("contains" in condition) return value !== null && String(value).toLowerCase().includes(condition.contains.toLowerCase());
      if ("not" in condition) return value !== condition.not;
    }
    return value === condition;
  });
}
const db = {
  organization: { findUnique: jest.fn(async ({ where }: { where: { id: string } }): Promise<{ isDemo: boolean } | null> => ({ isDemo: where.id === "org-a" && demoOrganization })) },
  user: { findUnique: jest.fn(async ({ where }: any) => {
    if (!["admin-a", "admin-b", "reader-a", "no-access-a"].includes(where.id)) return null;
    const organizationId = where.id === "admin-b" ? "org-b" : "org-a";
    const permissions = where.id === "reader-a" ? [PERMISSIONS.CUSTOMER_READ] : where.id === "no-access-a" ? [] :
      [PERMISSIONS.CUSTOMER_READ, PERMISSIONS.CUSTOMER_CREATE, PERMISSIONS.CUSTOMER_UPDATE, PERMISSIONS.CUSTOMER_DELETE];
    const permission = (name: string) => ({ id: name, name, organizationId: null });
    return { id: where.id, email: "admin@example.com", firstName: "Admin", lastName: "Member", status: "ACTIVE", deletedAt: null,
      platformRole: "NONE", securityStatus: "ACTIVE", sessionVersion: 0,
      organizationId, organization: { id: organizationId, slug: organizationId, status: "ACTIVE", billingEnabled: false },
      role: { id: "role-" + organizationId, name: "Admin", organizationId, deletedAt: null,
        permissions: permissions.map((name) => ({ permission: permission(name) })) },
      userPermissions: denied.map((name) => ({ isActive: false, permission: permission(name) })),
    };
  }) },
  customer: {
    findFirst: jest.fn(async ({ where }: any) => customers.find((row) => matches(row, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any) => customers.find((row) => matches(row, where)) ?? null),
    count: jest.fn(async ({ where }: any) => customers.filter((row) => matches(row, where)).length),
    findMany: jest.fn(async ({ where, orderBy, skip, take }: any) => {
      const [field, direction] = Object.entries(orderBy[0])[0]!;
      return customers.filter((row) => matches(row, where)).sort((a, b) => {
        const av = a[field as keyof CustomerRow], bv = b[field as keyof CustomerRow];
        const comparison = av instanceof Date && bv instanceof Date ? av.getTime() - bv.getTime() : String(av).localeCompare(String(bv));
        return comparison * (direction === "asc" ? 1 : -1) || a.id.localeCompare(b.id);
      }).slice(skip, skip + take);
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const index = customers.findIndex((row) => matches(row, where));
      if (index < 0) throw new Error("Missing or unscoped update target");
      customers[index] = { ...customers[index]!, ...data, updatedAt: new Date() };
      return customers[index];
    }),
    create: jest.fn(async ({ data }: any) => {
      const customer = { ...data, id: "created-a", createdAt: new Date(), updatedAt: new Date(), deletedAt: null };
      customers.push(customer);
      return customer;
    }),
  },
  $transaction: jest.fn(async (work: any, _options: unknown) => {
    const before = customers.map(row => ({ ...row }));
    try { return await work(db); } catch (error) { customers = before; throw error; }
  }),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {
  record,
  recordInTransaction: async (_db: unknown, event: unknown) => {
    if (failAudit) throw new Error("Audit unavailable");
    await record(event);
  },
} }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, invalidateCache,
  getOrSetCache: async (key: string, _ttl: number, loader: () => Promise<unknown>) => { cacheKeys.push(key); return loader(); },
}));
jest.unstable_mockModule("@/utils/tokens.js", () => ({
  verifyAccessToken: (sub: string) => ({ sub, organizationId: "untrusted-tenant", permissions: [] }),
}));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => ({ writeLimmiter: (_req: unknown, _res: unknown, next: () => void) => next() }));
const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { default: customerRoutes } = await import("@/modules/customer/customer.routes.js");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/customers", authenticate, customerRoutes);
const errors: ErrorRequestHandler = (error, _req, res, _next) => { res.status(error.statusCode ?? 500).json({ error: error.message }); };
app.use(errors);
beforeEach(() => { jest.clearAllMocks(); resetData(); failAudit = false; demoOrganization = false; });
const get = (path: string, actor = "admin-a") => request(app).get(path).set("Authorization", "Bearer " + actor);
const update = (id: string, body: object, actor = "admin-a") => request(app).put("/customers/" + id).set("Authorization", "Bearer " + actor).send(body);
const remove = (id: string, actor = "admin-a") => request(app).delete("/customers/" + id).set("Authorization", "Bearer " + actor);
const restore = (id: string, actor = "admin-a") => request(app).patch(`/customers/${id}/restore`).set("Authorization", "Bearer " + actor);

describe("Customer table API", () => {
  it("allows demo customers to retain their safe reserved phone when editing other fields", async () => {
    demoOrganization = true;
    customers[0]!.phoneNumber = "+12025550101";
    const response = await update("alice-a", { name: "Updated demo customer", phoneNumber: "+12025550101" });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ name: "Updated demo customer", phoneNumber: "+12025550101" });
    expect(db.organization.findUnique).toHaveBeenCalledWith({ where: { id: "org-a" }, select: { isDemo: true } });
  });

  it("accepts only the exact reserved sample range in a persisted demo workspace", async () => {
    demoOrganization = true;
    const response = await request(app).post("/customers").auth("admin-a", { type: "bearer" }).send({ name: "Demo Sample", email: "demo@example.test", phoneNumber: "+12025550103" });
    expect(response.status).toBe(201);
    expect((await update("alice-a", { phoneNumber: "+12025550104" })).status).toBe(400);
  });

  it.each(["create", "update"])("rejects reserved demo phone on real %s even with forged tenant mode", async (operation) => {
    const body = { name: "Reserved Contact", email: "reserved@example.test", phoneNumber: "+12025550102", isDemo: true, organizationId: "demo-org" };
    const response = operation === "create"
      ? await request(app).post("/customers").auth("admin-a", { type: "bearer" }).send(body)
      : await update("alice-a", body);
    expect(response.status).toBe(400);
    expect(db.customer.create).not.toHaveBeenCalled();
    expect(db.customer.update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted demo phone authorization cannot be loaded", async () => {
    db.organization.findUnique.mockRejectedValueOnce(new Error("Mode lookup unavailable"));
    expect((await update("alice-a", { phoneNumber: "+12025550101" })).status).toBe(500);
    expect(db.customer.update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("allows the same customer identifiers in two tenants and scopes update conflicts", async () => {
    const foreign = customers.find(row => row.id === "alice-b")!;
    const body = { name: foreign.name, email: foreign.email, phoneNumber: foreign.phoneNumber };
    const created = await request(app).post("/customers").auth("admin-a", { type: "bearer" }).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.organizationId).toBe("org-a");
    expect((await request(app).post("/customers").auth("admin-a", { type: "bearer" }).send(body)).status).toBe(409);
    customers = customers.filter(row => row.id !== "created-a");
    expect((await update("alice-a", body)).status).toBe(200);
  });

  it.each(["create", "update", "archive", "restore"])("rolls back %s and skips cache invalidation when mandatory audit fails", async operation => {
    const before = structuredClone(customers);
    failAudit = true;
    const response = operation === "create"
      ? await request(app).post("/customers").auth("admin-a", { type: "bearer" }).send({ name: "New Person", email: "new@example.com", phoneNumber: "09179999999" })
      : operation === "update" ? await update("alice-a", { notes: "changed" })
      : operation === "archive" ? await remove("alice-a") : await restore("deleted-a");
    expect(response.status).toBe(500);
    expect(customers).toEqual(before);
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("reserves archived identifiers only within their tenant", async () => {
    expect((await update("alice-a", { email: "deleted-a@example.com" })).status).toBe(409);
  });
  it("lists current tenant customers with newest first and ignores client tenant IDs", async () => {
    const response = await get("/customers?organizationId=org-b");
    expect(response.status).toBe(200);
    expect(response.body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["carol-a", "bob-a", "alice-a"]);
    expect(response.body.data.pagination.total).toBe(3);
    expect((await get("/customers", "admin-b")).body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["alice-b"]);
    expect(cacheKeys[0]).toContain("org-a");
    expect(cacheKeys[1]).toContain("org-b");
  });
  it("returns customer contact details, notes, and timestamps", async () => {
    const response = await get("/customers/alice-a");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ name: "Alice Able", notes: "Morning visits", createdAt: "2026-10-01T00:00:00.000Z" });
  });
  it("isolates deleted lists by tenant, supports filters/search and separates cache entries", async () => {
    customers.find((row) => row.id === "alice-b")!.deletedAt = new Date();
    const response = await get("/customers?deleted=true&organizationId=org-b");
    expect(response.status).toBe(200);
    expect(response.body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["deleted-a"]);
    expect(response.body.data.pagination.total).toBe(1);
    expect((await get("/customers?deleted=false")).body.data.pagination.total).toBe(3);
    expect(cacheKeys[0]).not.toBe(cacheKeys[1]);
    expect((await get("/customers?deleted=true&filter=missing_address&search=Deleted")).body.data.pagination.total).toBe(1);
    expect((await get("/customers?deleted=true&filter=with_notes&search=Deleted")).body.data.pagination.total).toBe(1);
    expect((await get("/customers?deleted=true&search=Alice")).body.data.pagination.total).toBe(0);
    expect((await get("/customers?deleted=true", "admin-b")).body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["alice-b"]);
  });
  it("restores only the deletion marker, audits and refreshes both lists", async () => {
    const before = { ...customers.find((row) => row.id === "deleted-a")! };
    const response = await restore("deleted-a");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: before.id, organizationId: before.organizationId, name: before.name, notes: before.notes, deletedAt: null });
    expect(db.customer.update).toHaveBeenCalledWith({
      where: { id: "deleted-a", organizationId: "org-a", deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      action: "restore.customer.success", entity: "Customer", entityId: "deleted-a",
      before: JSON.stringify(before), after: JSON.stringify(customers.find((row) => row.id === "deleted-a")),
    }));
    expect(invalidateCache).toHaveBeenCalledWith("cache:modules:v1:customers:org-a:*", "modules:v1:customers:org-a");
    expect((await get("/customers")).body.data.pagination.total).toBe(4);
    expect((await get("/customers?deleted=true")).body.data.pagination).toMatchObject({ total: 0, page: 1, totalPages: 1 });
    expect((await get("/customers/deleted-a")).status).toBe(200);
    expect((await restore("deleted-a")).status).toBe(404);
  });
  it.each(["alice-a", "alice-b", "missing"])("rejects restore for active, foreign or missing customer %s", async (id) => {
    if (id === "alice-b") customers.find((row) => row.id === id)!.deletedAt = new Date();
    expect((await restore(id)).status).toBe(404);
    expect(db.customer.update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
  });
  it("enforces authentication and effective update permission on restoration", async () => {
    expect((await request(app).patch("/customers/deleted-a/restore")).status).toBe(401);
    expect((await restore("deleted-a", "reader-a")).status).toBe(403);
    expect((await get("/customers?deleted=true", "no-access-a")).status).toBe(403);
    denied = [PERMISSIONS.CUSTOMER_UPDATE];
    expect((await restore("deleted-a")).status).toBe(403);
    expect(db.customer.update).not.toHaveBeenCalled();
  });
  it("preserves deleted state and reports failure when a restore write fails", async () => {
    db.customer.update.mockRejectedValueOnce(new Error("Database unavailable"));
    expect((await restore("deleted-a")).status).toBe(500);
    expect(customers.find((row) => row.id === "deleted-a")!.deletedAt).toBeInstanceOf(Date);
    expect(record).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
  });
  it.each(["alice-b", "deleted-a", "missing"])("rejects detail, edit and delete for unavailable customer %s", async (id) => {
    expect((await get("/customers/" + id)).status).toBe(404);
    expect((await update(id, { notes: "Changed" })).status).toBe(404);
    expect((await remove(id)).status).toBe(404);
    expect(db.customer.update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it("enforces read permissions and authentication", async () => {
    expect((await request(app).get("/customers")).status).toBe(401);
    expect((await get("/customers", "no-access-a")).status).toBe(403);
    expect((await get("/customers/alice-a", "no-access-a")).status).toBe(403);
    expect((await get("/customers/alice-a", "reader-a")).status).toBe(200);
    expect((await update("alice-a", { notes: "Changed" }, "reader-a")).status).toBe(403);
    expect((await remove("alice-a", "reader-a")).status).toBe(403);
    denied = [PERMISSIONS.CUSTOMER_READ];
    expect((await get("/customers/alice-a")).status).toBe(403);
  });
  it.each(["Able Alice", "Manila", "alice-a@example.com", "09171234560"])("searches customer fields for %s", async (search) => {
    const response = await get("/customers?search=" + encodeURIComponent(search));
    expect(response.body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["alice-a"]);
  });
  it("filters missing addresses and notes across all pages without foreign/deleted records", async () => {
    expect((await get("/customers?filter=missing_address")).body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["carol-a", "bob-a"]);
    expect((await get("/customers?filter=with_notes")).body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["alice-a"]);
    expect((await get("/customers?filter=missing_address&search=Alice")).body.data.pagination.total).toBe(0);
    expect(new Set(cacheKeys).size).toBe(3);
  });
  it.each(["name", "email", "createdAt"])("sorts %s in both directions", async (sortBy) => {
    expect((await get(`/customers?sortBy=${sortBy}&sortOrder=asc`)).body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["alice-a", "bob-a", "carol-a"]);
    expect((await get(`/customers?sortBy=${sortBy}&sortOrder=desc`)).body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["carol-a", "bob-a", "alice-a"]);
  });
  it.each(["page=0", "page=1.5", "pageSize=101", "pageSize=1.5", "sortBy=password", "sortOrder=invalid", "filter=invalid", "deleted=invalid", "deleted=1", "search=" + "x".repeat(201)])("rejects invalid list input %s", async (query) => {
    expect((await get("/customers?" + query)).status).toBe(400);
  });
  it("soft-deletes, audits, invalidates the tenant cache, and clamps the last page", async () => {
    expect((await remove("carol-a")).status).toBe(200);
    expect(customers.find((row) => row.id === "carol-a")?.deletedAt).toBeInstanceOf(Date);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "delete.customer.success", entityId: "carol-a" }));
    expect(invalidateCache).toHaveBeenCalledWith("cache:modules:v1:customers:org-a:*", "modules:v1:customers:org-a");
    const response = await get("/customers?page=3&pageSize=1");
    expect(response.body.data.pagination).toMatchObject({ page: 2, totalPages: 2, total: 2, hasNextPage: false });
    expect(response.body.data.customers.map((row: CustomerRow) => row.id)).toEqual(["alice-a"]);
    expect((await remove("carol-a")).status).toBe(404);
  });
  it("supports partial edits and strips privileged/unknown fields", async () => {
    const response = await update("alice-a", { notes: "New notes", organizationId: "org-b", id: "alice-b", deletedAt: new Date() });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: "alice-a", organizationId: "org-a", deletedAt: null, notes: "New notes" });
    expect(db.customer.findUnique).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "update.customer.success" }));
  });
  it("normalizes phone/email and permits optional blank fields", async () => {
    const response = await update("alice-a", { phoneNumber: "+63 917 123 4567", email: " ALICE-A@EXAMPLE.COM ", address: "", notes: "" });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ phoneNumber: "+639171234567", email: "alice-a@example.com", address: "", notes: "" });
  });
  it.each([{ email: "bob-a@example.com" }, { phoneNumber: "09171234561" }, { name: "Bob Baker" }])("rejects duplicate contact/name input %j", async (body) => {
    expect((await update("alice-a", body)).status).toBe(409);
    expect(db.customer.update).not.toHaveBeenCalled();
  });
  it("validates create input and derives organization ownership from the session", async () => {
    const response = await request(app).post("/customers").set("Authorization", "Bearer admin-a").send({
      name: "  New Customer  ", email: " NEW@EXAMPLE.COM ", phoneNumber: "+63 917 555 1234", organizationId: "org-b", deletedAt: new Date(), id: "alice-b",
    });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ name: "New Customer", email: "new@example.com", phoneNumber: "+639175551234", organizationId: "org-a", deletedAt: null });
    expect((await request(app).post("/customers").set("Authorization", "Bearer reader-a").send({})).status).toBe(403);
  });
  it("does not report success or audit on failed database writes", async () => {
    db.customer.update.mockRejectedValueOnce(new Error("Database unavailable"));
    expect((await remove("alice-a")).status).toBe(500);
    expect(record).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
    expect(customers.find((row) => row.id === "alice-a")?.deletedAt).toBeNull();
  });
});
