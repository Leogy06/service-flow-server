import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";

type RoleRow = { id: string; name: string; organizationId: string; deletedAt: Date | null; permissions: string[] };
type UserRow = {
  id: string; firstName: string; lastName: string; email: string; phone: string | null;
  organizationId: string; roleId: string; status: "ACTIVE" | "PENDING";
  createdAt: Date; deletedAt: Date | null; overrides: { name: string; isActive: boolean }[];
  sessionVersion: number;
};
let roles: RoleRow[];
let users: UserRow[];
let refreshTokens: { userId: string }[];
const record = jest.fn(async (_event: unknown) => {});
const invalidateCache = jest.fn(async (_key: string) => {});

function resetData() {
  roles = [
    { id: "admin-role-a", name: "Admin", organizationId: "org-a", deletedAt: null, permissions: [PERMISSIONS.USER_READ, PERMISSIONS.USER_UPDATE, PERMISSIONS.USER_DELETE] },
    { id: "staff-role-a", name: "Technician", organizationId: "org-a", deletedAt: null, permissions: [] },
    { id: "staff-role-b", name: "Private B", organizationId: "org-b", deletedAt: null, permissions: [] },
    { id: "archived-role-a", name: "Archived", organizationId: "org-a", deletedAt: new Date(), permissions: [] },
  ];
  users = [
    ["admin-a", "Admin", "Zeta", "org-a", "admin-role-a", "ACTIVE", "2026-10-01"],
    ["staff-a", "Alice", "Able", "org-a", "staff-role-a", "ACTIVE", "2026-10-02"],
    ["pending-a", "Bob", "Baker", "org-a", "staff-role-a", "PENDING", "2026-10-03"],
    ["deleted-a", "Carol", "Cole", "org-a", "staff-role-a", "ACTIVE", "2026-10-04"],
    ["staff-b", "Alice", "Private", "org-b", "staff-role-b", "ACTIVE", "2026-10-05"],
  ].map(([id, firstName, lastName, organizationId, roleId, status, date]) => ({
    id, firstName, lastName, email: id + "@example.com", organizationId, roleId,
    status: status as UserRow["status"], phone: null, createdAt: new Date(date!),
    deletedAt: id === "deleted-a" ? new Date() : null, overrides: [], sessionVersion: 0,
  }));
  refreshTokens = [{ userId: "admin-a" }, { userId: "staff-a" }];
}
function view(user: UserRow) {
  const role = roles.find((r) => r.id === user.roleId)!;
  return { ...user, password: "private-hash", inviteToken: "private-token", inviteTokenExpiry: new Date(),
    platformRole: "NONE", securityStatus: "ACTIVE",
    organization: { id: user.organizationId, slug: user.organizationId, status: "ACTIVE", billingEnabled: false },
    role: { ...role, permissions: role.permissions.map((name) => ({ permission: { id: name, name, organizationId: null } })) },
    userPermissions: user.overrides.map(({ name, isActive }) => ({ isActive, permission: { id: name, name, organizationId: null } })),
  };
}
function matches(user: UserRow, where: any): boolean {
  const role = roles.find((r) => r.id === user.roleId)!;
  const fields = view(user);
  return ["id", "email", "phone", "organizationId", "roleId", "status", "platformRole", "securityStatus"].every((field) => where[field] === undefined || fields[field as keyof typeof fields] === where[field]) &&
    (where.deletedAt === undefined || (where.deletedAt === null ? !user.deletedAt : !!user.deletedAt)) &&
    (!where.role || ((!where.role.organizationId || role.organizationId === where.role.organizationId) &&
      (where.role.deletedAt !== null || !role.deletedAt) && (!where.role.name || role.name === where.role.name))) &&
    (!where.AND || where.AND.every((item: any) => matches(user, item))) &&
    (!where.OR || where.OR.some((item: any) => Object.entries(item).every(([field, condition]: any) =>
      String(fields[field as keyof typeof fields]).toLowerCase().includes(condition.contains.toLowerCase()))));
}
function select(row: Record<string, unknown>, selection?: Record<string, unknown>) {
  return selection ? Object.fromEntries(Object.keys(selection).map((field) => [field, row[field]])) : row;
}
const db = {
  user: {
    findFirst: jest.fn(async ({ where, select: selection }: any) => {
      const user = users.find((u) => matches(u, where));
      return user ? select(view(user), selection) : null;
    }),
    findUnique: jest.fn(async ({ where, select: selection }: any) => {
      const user = users.find((u) => matches(u, where));
      return user ? select(view(user), selection) : null;
    }),
    findMany: jest.fn(async ({ where, select: selection, orderBy, skip, take }: any) => {
      const [field, direction] = Object.entries(orderBy[0])[0]!;
      return users.filter((u) => matches(u, where)).sort((a, b) => {
        const av = a[field as keyof UserRow], bv = b[field as keyof UserRow];
        const comparison = av instanceof Date && bv instanceof Date ? av.getTime() - bv.getTime() : String(av).localeCompare(String(bv));
        return comparison * (direction === "desc" ? -1 : 1) || a.id.localeCompare(b.id);
      }).slice(skip, skip + take).map((u) => select(view(u), selection));
    }),
    count: jest.fn(async ({ where }: any) => users.filter((u) => matches(u, where)).length),
    update: jest.fn(async ({ where, data }: any) => {
      const user = users.find((u) => matches(u, where));
      if (!user) throw new Error("Unscoped or missing update target");
      const { sessionVersion, ...fields } = data;
      Object.assign(user, fields);
      if (sessionVersion) user.sessionVersion += sessionVersion.increment;
      return view(user);
    }),
  },
  role: { findMany: jest.fn(async ({ where, select: selection }: any) => roles
    .filter((r) => r.organizationId === where.organizationId && !r.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name)).map((r) => select(r, selection))) },
  organization: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, billingEnabled: false })) },
  refreshToken: { deleteMany: jest.fn(async ({ where }: any) => {
    const before = refreshTokens.length;
    refreshTokens = refreshTokens.filter((token) => token.userId !== where.userId);
    return { count: before - refreshTokens.length };
  }) },
  $queryRaw: jest.fn(async (_strings: TemplateStringsArray, id: string) => [{ id }]),
  $transaction: jest.fn(async (work: any, _options: unknown) => work(db)),
};
jest.unstable_mockModule("@/config/env.js", () => ({ env: { SALT_ROUNDS: 10 } }));
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: { record, recordInTransaction: async (_db: unknown, event: unknown) => record(event) } }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, invalidateCache,
  getOrSetCache: async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
}));
jest.unstable_mockModule("@/utils/tokens.js", () => ({
  // Deliberately incorrect token tenant: authorization must load the trusted user's organization.
  verifyAccessToken: (token: string) => {
    const [sub, version] = token.split(":");
    return { sub, sessionVersion: Number(version ?? 0), organizationId: "org-b", permissions: [] };
  },
}));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { writeLimmiter: pass, deleteLimiter: pass };
});
jest.unstable_mockModule("@/lib/email/send-invite", () => ({ sendInviteEmail: jest.fn(async () => {}) }));
const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { default: userRoutes } = await import("@/modules/user/user.routes.js");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/users", authenticate, userRoutes);
const errors: ErrorRequestHandler = (error, _req, res, _next) => { res.status(error.statusCode ?? 500).json({ error: error.message }); };
app.use(errors);
beforeEach(() => { jest.clearAllMocks(); resetData(); });
const get = (path: string, actor = "admin-a") => request(app).get(path).set("Authorization", "Bearer " + actor);
const remove = (id: string, actor = "admin-a") => request(app).delete("/users/" + id).set("Authorization", "Bearer " + actor);
const restore = (id: string, actor = "admin-a") => request(app).patch("/users/" + id + "/restore").set("Authorization", "Bearer " + actor);
const update = (id: string, body: object, actor = "admin-a") => request(app).put("/users/" + id).set("Authorization", "Bearer " + actor).send(body);
const edit = { id: "staff-a", firstName: "Updated", lastName: "Able", email: "staff-a@example.com", phone: "" };

describe("User table API", () => {
  it("returns tenant-only current users and creation dates, with no credentials", async () => {
    const response = await get("/users?organizationId=org-b");
    expect(response.status).toBe(200);
    expect(response.body.data.users.map((u: any) => u.id)).toEqual(["pending-a", "staff-a", "admin-a"]);
    expect(response.body.data.users[0].createdAt).toBe("2026-10-03T00:00:00.000Z");
    expect(response.body.data.users[0]).not.toHaveProperty("password");
    expect(response.body.data.users[0]).not.toHaveProperty("inviteToken");
  });
  it("combines deleted, status, role and search filters", async () => {
    const response = await get("/users?deleted=true&status=active&roleId=staff-role-a&search=CAROL");
    expect(response.status).toBe(200);
    expect(response.body.data.users.map((u: any) => u.id)).toEqual(["deleted-a"]);
    expect(response.body.data.pagination.total).toBe(1);
    expect((await get("/users?roleId=staff-role-b")).body.data.users).toEqual([]);
    expect((await get("/users?status=pending")).body.data.users.map((u: any) => u.id)).toEqual(["pending-a"]);
  });
  it.each(["Alice", "Able", "staff-a@example.com", "Alice Able", "Able, Alice"])("searches names and email within the tenant: %s", async (search) => {
    expect((await get("/users?search=" + search)).body.data.users.map((u: any) => u.id)).toEqual(["staff-a"]);
  });
  it("sorts by creation date in both directions with a stable tie-breaker", async () => {
    expect((await get("/users?sortBy=createdAt&sortOrder=asc")).body.data.users.map((u: any) => u.id)).toEqual(["admin-a", "staff-a", "pending-a"]);
    expect(db.user.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
    expect((await get("/users?sortBy=createdAt&sortOrder=desc")).body.data.users.map((u: any) => u.id)).toEqual(["pending-a", "staff-a", "admin-a"]);
  });
  it("bounds the page after deleting its last user and keeps totals consistent", async () => {
    expect((await get("/users?page=2&pageSize=2")).body.data.pagination.page).toBe(2);
    expect((await remove("staff-a")).status).toBe(200);
    const response = await get("/users?page=2&pageSize=2");
    expect(response.body.data.pagination).toEqual({ total: 2, totalPages: 1, page: 1, pageSize: 2, hasNextPage: false, hasPreviousPage: false });
    expect(response.body.data.users).toHaveLength(2);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  });
  it("returns a valid first page for empty search results", async () => {
    const response = await get("/users?search=missing&page=999");
    expect(response.body.data.users).toEqual([]);
    expect(response.body.data.pagination).toEqual({ total: 0, totalPages: 1, page: 1, pageSize: 10, hasNextPage: false, hasPreviousPage: false });
  });
  it("lists tenant role names for readers without permission to change users", async () => {
    users.find((u) => u.id === "staff-a")!.overrides.push({ name: PERMISSIONS.USER_READ, isActive: true });
    const response = await get("/users/roles?organizationId=org-b", "staff-a");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: "admin-role-a", name: "Admin" }, { id: "staff-role-a", name: "Technician" }]);
    expect((await get("/users/roles", "staff-b")).status).toBe(403);
  });
  it("soft-deletes, invalidates caches, audits and restores without changing role or status", async () => {
    const deleted = await remove("staff-a");
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deletedAt).not.toBeNull();
    expect(deleted.body.data).not.toHaveProperty("password");
    expect((await get("/users", "staff-a")).status).toBe(401);
    expect((await restore("staff-a")).status).toBe(200);
    expect(users.find((u) => u.id === "staff-a")).toMatchObject({ deletedAt: null, roleId: "staff-role-a", status: "ACTIVE" });
    expect(invalidateCache).toHaveBeenCalledWith("cache:users:list*");
    expect(record.mock.calls.map(([event]: any) => event.action)).toEqual(["delete.user.success", "restore.user.success"]);
  });
  it("rejects self-deletion, repeated deletion and restoring a current user", async () => {
    expect((await remove("admin-a")).status).toBe(400);
    expect((await remove("deleted-a")).status).toBe(404);
    expect((await restore("staff-a")).status).toBe(404);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("keeps pre-deletion access and refresh sessions invalid after restoration", async () => {
    users.find((user) => user.id === "staff-a")!.overrides.push({ name: PERMISSIONS.USER_READ, isActive: true });
    expect((await get("/users", "staff-a")).status).toBe(200);
    expect((await remove("staff-a")).status).toBe(200);
    expect(users.find((user) => user.id === "staff-a")!.sessionVersion).toBe(1);
    expect(refreshTokens.some((token) => token.userId === "staff-a")).toBe(false);
    expect((await restore("staff-a")).status).toBe(200);
    expect(users.find((user) => user.id === "staff-a")!.sessionVersion).toBe(2);
    expect((await get("/users", "staff-a")).status).toBe(401);
    expect((await get("/users", "staff-a:2")).status).toBe(200);
    expect(refreshTokens).toEqual([{ userId: "admin-a" }]);
  });
  it("conceals foreign users during update, delete and restore", async () => {
    expect((await update("staff-b", { ...edit, id: "staff-b" })).status).toBe(404);
    expect((await remove("staff-b")).status).toBe(404);
    users.find((u) => u.id === "staff-b")!.deletedAt = new Date();
    expect((await restore("staff-b")).status).toBe(404);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("requires effective permissions for reads, updates, delete and restore", async () => {
    expect((await get("/users", "staff-a")).status).toBe(403);
    expect((await update("pending-a", { ...edit, id: "pending-a" }, "staff-a")).status).toBe(403);
    expect((await remove("pending-a", "staff-a")).status).toBe(403);
    expect((await restore("deleted-a", "staff-a")).status).toBe(403);
    users.find((u) => u.id === "admin-a")!.overrides.push({ name: PERMISSIONS.USER_DELETE, isActive: false });
    expect((await remove("pending-a")).status).toBe(403);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("updates without a client organization ID and clears an optional phone", async () => {
    const response = await update("staff-a", { ...edit, organizationId: "org-b", roleId: "staff-role-b" });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ firstName: "Updated", organizationId: "org-a", roleId: "staff-role-a", phone: null });
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "staff-a", organizationId: "org-a", deletedAt: null } }));
  });
  it("rejects mismatched update IDs and invalid list parameters", async () => {
    expect((await update("staff-a", { ...edit, id: "staff-b" })).status).toBe(400);
    for (const query of ["page=0", "pageSize=101", "sortBy=password", "deleted=anything", "status=inactive"]) {
      expect((await get("/users?" + query)).status).toBe(400);
    }
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
