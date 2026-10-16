import { jest } from "@jest/globals";
import express, { type ErrorRequestHandler } from "express";
import { createServer, type Server } from "node:http";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";

type Grant = { permissionId: string; isActive: boolean };
type RoleRow = { id: string; name: string; organizationId: string | null; deletedAt?: Date | null; grants: Grant[] };
type UserRow = { id: string; roleId: string; organizationId: string | null; platformRole?: "NONE" | "SYSTEM_ADMIN"; status: string; deletedAt: Date | null; grants: Grant[] };
type PermissionRow = { id: string; name: string; organizationId: string | null; description: string };
let roles: RoleRow[];
let users: UserRow[];
let permissions: PermissionRow[];
let billingEnabled = false;
const grant = (permissionId: string, isActive = true) => ({ permissionId, isActive });
const record = jest.fn(async (_event: unknown) => {});

function resetData() {
  billingEnabled = false;
  permissions = [
    ["read", PERMISSIONS.CUSTOMER_READ], ["update", PERMISSIONS.CUSTOMER_UPDATE],
    ["role-read", PERMISSIONS.ROLE_READ], ["role-create", PERMISSIONS.ROLE_CREATE],
    ["role-update", PERMISSIONS.ROLE_UPDATE], ["role-delete", PERMISSIONS.ROLE_DELETE],
    ["user-read", PERMISSIONS.USER_READ], ["user-create", PERMISSIONS.USER_CREATE], ["user-update", PERMISSIONS.USER_UPDATE],
    ["system", PERMISSIONS.SYSTEM_ADMIN_UPDATE], ["unheld", PERMISSIONS.JOB_DELETE],
  ].map(([id, name]) => ({ id, name, organizationId: null, description: name }));
  permissions.push({ id: "foreign", name: PERMISSIONS.INVOICE_DELETE, organizationId: "org-b", description: "Private tenant B definition" });
  roles = [
    { id: "admin-role-a", name: "Admin", organizationId: "org-a", grants: permissions.filter((p) => p.id !== "unheld" && p.id !== "foreign").map((p) => grant(p.id)) },
    { id: "staff-role-a", name: "Staff", organizationId: "org-a", grants: [grant("read")] },
    { id: "empty-role-a", name: "Empty", organizationId: "org-a", grants: [] },
    { id: "staff-role-b", name: "Staff B", organizationId: "org-b", grants: [grant("read")] },
    { id: "global-role", name: "PLATFORM_ADMIN", organizationId: null, grants: [grant("system")] },
  ];
  users = [
    { id: "admin-a", roleId: "admin-role-a", organizationId: "org-a", status: "ACTIVE", deletedAt: null, grants: [] },
    { id: "staff-a", roleId: "staff-role-a", organizationId: "org-a", status: "ACTIVE", deletedAt: null, grants: [] },
    { id: "staff-b", roleId: "staff-role-b", organizationId: "org-b", status: "ACTIVE", deletedAt: null, grants: [] },
  ];
}
function grantViews(grants: Grant[], activeOnly = true) {
  return grants.filter((g) => !activeOnly || g.isActive).map((g) => ({ ...g, permission: permissions.find((p) => p.id === g.permissionId)! }));
}
function roleView(role: RoleRow) {
  return { ...role, deletedAt: role.deletedAt ?? null, permissions: grantViews(role.grants), _count: { users: users.filter((u) => u.roleId === role.id).length } };
}
function userView(user: UserRow) {
  return { ...user, email: user.id + "@example.com", firstName: user.id, lastName: "Test", middleName: null, suffix: null, password: "hash",
    platformRole: user.platformRole ?? "NONE", securityStatus: "ACTIVE", sessionVersion: 0,
    organization: user.organizationId ? { id: user.organizationId, slug: user.organizationId, status: "ACTIVE", billingEnabled } : null,
    role: roleView(roles.find((r) => r.id === user.roleId)!), userPermissions: grantViews(user.grants, false),
  };
}
function upsertGrant(list: Grant[], permissionId: string, isActive = true) {
  const existing = list.find((g) => g.permissionId === permissionId);
  if (existing) existing.isActive = isActive;
  else list.push(grant(permissionId, isActive));
}
function matchesRole(role: RoleRow, where: any) {
  return (!where.id || role.id === where.id) &&
    (where.organizationId === undefined || role.organizationId === where.organizationId) &&
    (where.deletedAt === undefined || (where.deletedAt === null ? !role.deletedAt : !!role.deletedAt)) &&
    (!where.NOT?.id || role.id !== where.NOT.id) &&
    (!where.name || (typeof where.name === "string" ? role.name.toLowerCase() === where.name.toLowerCase() : role.name.toLowerCase().includes(where.name.contains.toLowerCase())));
}
// Repository mocks enforce query scopes against two tenants. No live database or Redis is used.
const transaction = jest.fn<(work: any) => Promise<any>>();
const db = {
  user: {
    count: jest.fn(async ({ where }: any) => users.filter((user) =>
      user.organizationId === where.organizationId && user.deletedAt === where.deletedAt &&
      (user.platformRole ?? "NONE") === where.platformRole &&
      (typeof where.status === "string" ? user.status === where.status : where.status.in.includes(user.status))).length),
    findMany: jest.fn(async ({ where }: any) => users.filter((u) => u.organizationId === where.organizationId && !u.deletedAt).map(userView)),
    findUnique: jest.fn(async ({ where }: any) => { const user = users.find((u) => u.id === where.id); return user ? userView(user) : null; }),
    findFirst: jest.fn(async ({ where }: any) => {
      const user = users.find((u) => (!where.id || u.id === where.id) && (!where.email || u.id + "@example.com" === where.email) &&
        (where.organizationId === undefined || u.organizationId === where.organizationId) && (where.deletedAt !== null || u.deletedAt === null));
      return user ? userView(user) : null;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const user = users.find((u) => u.id === where.id && u.organizationId === where.organizationId)!;
      Object.assign(user, data); return userView(user);
    }),
    create: jest.fn(async ({ data }: any) => {
      const user: UserRow = { id: "new-user", roleId: data.role?.connect.id ?? data.roleId, organizationId: data.organization?.connect.id ?? data.organizationId ?? null, status: data.status ?? "PENDING", deletedAt: null, grants: [] };
      users.push(user);
      return { ...userView(user), ...data };
    }),
  },
  role: {
    findFirst: jest.fn(async ({ where }: any) => { const role = roles.find((r) => matchesRole(r, where)); return role ? roleView(role) : null; }),
    count: jest.fn(async ({ where }: any) => roles.filter((r) => matchesRole(r, where)).length),
    findMany: jest.fn(async ({ where, orderBy, skip = 0, take }: any) => {
      const order = Array.isArray(orderBy) ? orderBy[0] : orderBy;
      const sorted = roles.filter((r) => matchesRole(r, where)).sort((a, b) =>
        (order?.name === "desc" ? -1 : 1) * a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return sorted.slice(skip, take === undefined ? undefined : skip + take).map(roleView);
    }),
    create: jest.fn(async ({ data }: any) => { const role: RoleRow = { id: "new-role", name: data.name, organizationId: data.organizationId, grants: data.permissions.create.map((g: any) => grant(g.permissionId)) }; roles.push(role); return roleView(role); }),
    update: jest.fn(async ({ where, data }: any) => { const role = roles.find((r) => r.id === where.id && r.organizationId === where.organizationId)!; Object.assign(role, data); return roleView(role); }),
    delete: jest.fn(async ({ where }: any) => { roles = roles.filter((r) => r.id !== where.id || r.organizationId !== where.organizationId); }),
  },
  permission: {
    findMany: jest.fn(async ({ where }: any) => permissions.filter((p) =>
      (!where.id || where.id.in.includes(p.id)) && (!where.name || where.name.in.includes(p.name)) && where.OR.some((scope: any) => scope.organizationId === p.organizationId))),
  },
  rolePermission: {
    updateMany: jest.fn(async ({ where }: any) => { roles.find((r) => r.id === where.roleId)!.grants.forEach((g) => { g.isActive = false; }); }),
    upsert: jest.fn(async ({ create }: any) => { upsertGrant(roles.find((r) => r.id === create.roleId)!.grants, create.permissionId); }),
    deleteMany: jest.fn(async ({ where }: any) => { roles.find((r) => r.id === where.roleId)!.grants = []; }),
  },
  userPermission: {
    findMany: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.userId)!.grants.filter((g) => where.isActive === undefined || g.isActive === where.isActive).map((g) => ({ ...g }))),
    updateMany: jest.fn(async ({ where }: any) => { users.find((u) => u.id === where.userId)!.grants.forEach((g) => { g.isActive = false; }); }),
    deleteMany: jest.fn(async ({ where }: any) => { const user = users.find((u) => u.id === where.userId)!; user.grants = user.grants.filter((g) => (where.permissionId !== undefined && g.permissionId !== where.permissionId) || (where.isActive !== undefined && g.isActive !== where.isActive)); }),
    upsert: jest.fn(async ({ create }: any) => { upsertGrant(users.find((u) => u.id === create.userId)!.grants, create.permissionId, create.isActive); }),
  },
  refreshToken: {
    findUnique: jest.fn(async () => ({ id: "refresh", userId: "staff-a", organizationId: "org-a", expiresAt: new Date(Date.now() + 60000), user: userView(users.find((u) => u.id === "staff-a")!) })),
    delete: jest.fn(async () => ({})), create: jest.fn(async () => ({})),
  },
  organization: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, billingEnabled })) },
  subscription: { findUnique: jest.fn(async () => ({ status: "ACTIVE", startsAt: new Date(Date.now() - 86_400_000),
    expiresAt: new Date(Date.now() + 86_400_000), plan: { maxActiveUsers: 3 } })) },
  $queryRaw: jest.fn(async (_strings: TemplateStringsArray, id: string) => [{ id }]),
  auditLog: { create: jest.fn(async ({ data }: any) => record(data)) },
  $transaction: transaction,
};
transaction.mockImplementation(async (work: any) => {
  const saved = structuredClone({ roles, users, permissions });
  try { return typeof work === "function" ? await work(db) : await Promise.all(work); }
  catch (error) { ({ roles, users, permissions } = saved); throw error; }
});
const generateAccessToken = jest.fn((_user: unknown) => "fresh-token");
jest.unstable_mockModule("@/config/env.js", () => ({ env: { SALT_ROUNDS: 10 } }));
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {
  record, recordInTransaction: async (_db: unknown, event: unknown) => record(event),
} }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ invalidateCache: jest.fn(async () => {}), getOrSetCache: jest.fn(), DEFAULT_TTL_SECONDS: 60 }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({
  verifyAccessToken: (token: string) => ({ sub: token, role: "Admin", organizationId: "org-b", permissions: Object.values(PERMISSIONS) }),
  generateAccessToken, generateRefreshTokenValue: () => "new-refresh", hashToken: (value: string) => value, getRefreshExpiry: () => new Date(), REFRESH_TOKEN_DAYS: 7,
}));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { writeLimmiter: pass, deleteLimiter: pass, authLimiter: pass, strictLimiter: pass };
});
jest.unstable_mockModule("@/lib/email/send-invite", () => ({ sendInviteEmail: jest.fn(async () => {}) }));
jest.unstable_mockModule("bcryptjs", () => ({ default: { compare: jest.fn(async () => true), hash: jest.fn(async () => "hash") } }));

const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { requirePermission } = await import("@/middleware/require-permission.js");
const { default: roleRoutes } = await import("@/modules/role/role.routes.js");
const { default: userPermissionRoutes } = await import("@/modules/user-permission/user.permission.routes.js");
const { default: rolePermissionRoutes } = await import("@/modules/role-permission/role.permission.routes.js");
const { default: permissionRoutes } = await import("@/modules/permission/permission.route.js");
const { default: userRoutes } = await import("@/modules/user/user.routes.js");
const { default: systemAdminRoutes } = await import("@/modules/user/routes/system-admin.routes.js");
const { authService } = await import("@/modules/auth/auth.service.js");
const { default: authRoutes } = await import("@/modules/auth/auth.routes.js");
const { requestContext } = await import("@/lib/requestContext.js");
const { userService } = await import("@/modules/user/user.service.js");

let server: Server;
let origin: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json(), withRequestContext);
  app.use("/role", authenticate, roleRoutes);
  app.use("/user-permission", userPermissionRoutes);
  app.use("/role-permission", rolePermissionRoutes);
  app.use("/permission", permissionRoutes);
  app.use("/users", authenticate, userRoutes);
  app.use("/system-admin", authenticate, systemAdminRoutes);
  app.use("/auth", authRoutes);
  app.get("/probe", authenticate, requirePermission(PERMISSIONS.CUSTOMER_READ), (_req, res) => res.json({ ok: true }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => { res.status(error.statusCode ?? 500).json({ error: error.message }); };
  app.use(errors);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  origin = "http://127.0.0.1:" + address.port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
beforeEach(() => { jest.clearAllMocks(); resetData(); });
async function request(path: string, method = "GET", body?: unknown, token = "admin-a") {
  const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
}

describe("Role table and archive management", () => {
  it("paginates tenant results with stable names, totals and a bounded page", async () => {
    const first = await request("/role?page=1&pageSize=2&sortBy=name&sortOrder=asc");
    expect(first.body.data.roles.map((r: any) => r.name)).toEqual(["Admin", "Empty"]);
    expect(first.body.data.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
    const last = await request("/role?page=999&pageSize=2");
    expect(last.body.data.roles.map((r: any) => r.name)).toEqual(["Staff"]);
    expect(last.body.data.pagination.page).toBe(2);
    expect(db.role.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 2, take: 2, where: { organizationId: "org-a", deletedAt: null } }));
  });
  it("searches only tenant role names and sorts descending", async () => {
    const response = await request("/role?search=STAFF&sortOrder=desc");
    expect(response.body.data.roles.map((r: any) => r.id)).toEqual(["staff-role-a"]);
    expect(response.body.data.pagination.total).toBe(1);
    const desc = await request("/role?sortOrder=desc&pageSize=2");
    expect(desc.body.data.roles.map((r: any) => r.name)).toEqual(["Staff", "Empty"]);
    const empty = await request("/role?search=missing");
    expect(empty.body.data.roles).toEqual([]);
    expect(empty.body.data.pagination.total).toBe(0);
  });
  it.each(["page=0", "page=1.5", "pageSize=101", "sortBy=organizationId", "sortOrder=invalid", "deleted=anything", "organizationId=org-b"])("rejects invalid table query %s", async (query) => {
    expect((await request("/role?" + query)).status).toBe(400);
    expect(db.role.count).not.toHaveBeenCalled();
  });
  it("rejects organization-local duplicate names, including case variants and archived names", async () => {
    expect((await request("/role", "POST", { name: "staff", permissionIds: [] })).status).toBe(409);
    expect((await request("/role/empty-role-a", "PATCH", { name: "Staff" })).status).toBe(409);
    roles.find((r) => r.id === "empty-role-a")!.deletedAt = new Date();
    expect((await request("/role", "POST", { name: "Empty", permissionIds: [] })).status).toBe(409);
    expect((await request("/role", "POST", { name: "Staff B", permissionIds: [] })).status).toBe(201);
  });
  it("renames a role without writing role defaults or user overrides", async () => {
    users.find((u) => u.id === "staff-a")!.grants = [grant("read", false), grant("update")];
    const before = structuredClone({ users, grants: roles.find((r) => r.id === "staff-role-a")!.grants });
    expect((await request("/role/staff-role-a", "PATCH", { name: "Dispatch" })).status).toBe(200);
    expect(users).toEqual(before.users);
    expect(roles.find((r) => r.id === "staff-role-a")!.grants).toEqual(before.grants);
    expect(db.rolePermission.updateMany).not.toHaveBeenCalled();
    expect(db.userPermission.upsert).not.toHaveBeenCalled();
  });
  it("archives without deleting defaults, hides active lookups and restores the exact defaults", async () => {
    const role = roles.find((r) => r.id === "empty-role-a")!;
    role.grants = [grant("read"), grant("update", false)];
    const before = structuredClone(role.grants);
    const archived = await request("/role/empty-role-a", "DELETE");
    expect(archived.status).toBe(200);
    expect(archived.body.data.deletedAt).toBeTruthy();
    expect(archived.body.data.assignable).toBe(false);
    expect(role.grants).toEqual(before);
    expect(db.role.delete).not.toHaveBeenCalled();
    expect(db.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect((await request("/role/empty-role-a")).status).toBe(404);
    expect((await request("/role/empty-role-a", "PATCH", { name: "Hidden" })).status).toBe(404);
    expect((await request("/role/empty-role-a", "DELETE")).status).toBe(404);
    expect((await request("/role")).body.data.roles.some((r: any) => r.id === role.id)).toBe(false);
    expect((await request("/role?deleted=true")).body.data.roles.map((r: any) => r.id)).toEqual([role.id]);
    expect((await request("/role/assignable")).body.data.some((r: any) => r.id === role.id)).toBe(false);
    expect((await request("/users/staff-a/role", "PATCH", { roleId: role.id })).status).toBe(404);
    expect((await request("/role/empty-role-a/restore", "PATCH", {})).status).toBe(200);
    expect(roles.find((r) => r.id === role.id)!.deletedAt).toBeNull();
    expect(roles.find((r) => r.id === role.id)!.grants).toEqual(before);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "delete.role.success", before: expect.objectContaining({ deletedAt: null }), after: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: "restore.role.success", after: expect.objectContaining({ deletedAt: null }) }));
  });
  it.each(["staff-role-b", "global-role", "missing", "empty-role-a"])("conceals foreign, missing or active restoration targets: %s", async (id) => {
    expect((await request(`/role/${id}/restore`, "PATCH", {})).status).toBe(404);
  });
  it("prevents protected or out-of-authority archived roles from being restored", async () => {
    roles.push({ id: "archived-admin", name: "Tenant Admin", organizationId: "org-a", deletedAt: new Date(), grants: [] });
    expect((await request("/role/archived-admin/restore", "PATCH", { name: "Safe" })).status).toBe(403);
    const role = roles.find((r) => r.id === "empty-role-a")!;
    role.deletedAt = new Date();
    for (const id of ["system", "unheld", "foreign"]) {
      role.grants = [grant(id)];
      expect((await request("/role/empty-role-a/restore", "PATCH", {})).status).toBe(403);
    }
  });
  it("requires role update authority and an actual tenant administrator for restore", async () => {
    roles.find((r) => r.id === "empty-role-a")!.deletedAt = new Date();
    roles.find((r) => r.id === "staff-role-a")!.grants.push(grant("role-update"));
    expect((await request("/role/empty-role-a/restore", "PATCH", {}, "staff-a")).status).toBe(403);
    users.find((u) => u.id === "admin-a")!.grants.push(grant("role-update", false));
    expect((await request("/role/empty-role-a/restore", "PATCH", {})).status).toBe(403);
  });
  it("keeps archives intact on name conflicts, rejects reserved names and accepts a new unique name", async () => {
    roles.find((r) => r.id === "empty-role-a")!.deletedAt = new Date();
    expect((await request("/role/empty-role-a/restore", "PATCH", { name: "Staff" })).status).toBe(409);
    expect(roles.find((r) => r.id === "empty-role-a")!.deletedAt).toBeTruthy();
    expect((await request("/role/empty-role-a/restore", "PATCH", { name: "Admin" })).status).toBe(403);
    expect((await request("/role/empty-role-a/restore", "PATCH", { name: "Restored" })).status).toBe(200);
    expect(roles.find((r) => r.id === "empty-role-a")!.name).toBe("Restored");
  });
  it("rejects restore mass assignment and invalid names", async () => {
    roles.find((r) => r.id === "empty-role-a")!.deletedAt = new Date();
    for (const body of [{ name: "x" }, { permissionIds: [] }, { organizationId: "org-b" }, { deletedAt: null }]) {
      expect((await request("/role/empty-role-a/restore", "PATCH", body)).status).toBe(400);
    }
    expect(record).not.toHaveBeenCalled();
  });
  it.each(["archive", "restore"])("rolls back %s and retains defaults when audit insertion fails", async (operation) => {
    roles.find((r) => r.id === "empty-role-a")!.deletedAt = operation === "restore" ? new Date() : null;
    const before = structuredClone(roles);
    record.mockRejectedValueOnce(new Error("Audit unavailable"));
    const response = operation === "archive" ? await request("/role/empty-role-a", "DELETE") : await request("/role/empty-role-a/restore", "PATCH", {});
    expect(response.status).toBe(500);
    expect(roles).toEqual(before);
  });
  it("rejects an archived assigned role during authentication even with an existing token", async () => {
    roles.find((r) => r.id === "staff-role-a")!.deletedAt = new Date();
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(401);
  });
  it("rejects archived roles during invitation validation", async () => {
    roles.find((r) => r.id === "empty-role-a")!.deletedAt = new Date();
    await expect(userService.validateCreateInput({ email: "new@example.com", organizationId: "org-a", roleId: "empty-role-a" } as any)).rejects.toThrow("Role not found");
  });
});

describe("Tenant access management routes", () => {
  it("lists only the authenticated organization and does not trust token organization claims", async () => {
    const response = await request("/role");
    expect(response.status).toBe(200);
    expect(response.body.data.roles.map((r: any) => r.id)).toEqual(["admin-role-a", "empty-role-a", "staff-role-a"]);
  });
  it("enforces permission checks even when an old token claims admin privileges", async () => {
    expect((await request("/role", "POST", { name: "Evil", permissionIds: [] }, "staff-a")).status).toBe(403);
    expect(db.role.create).not.toHaveBeenCalled();
  });
  it("requires an actual Tenant Admin even when a staff role holds the route permission", async () => {
    roles.find((r) => r.id === "staff-role-a")!.grants.push(grant("role-create"));
    expect((await request("/role", "POST", { name: "Evil", permissionIds: [] }, "staff-a")).status).toBe(403);
  });
  it("separates user-assignment choices from role read authority", async () => {
    roles.find((r) => r.id === "admin-role-a")!.grants.find((g) => g.permissionId === "role-read")!.isActive = false;
    expect((await request("/role")).status).toBe(403);
    const choices = await request("/role/assignable");
    expect(choices.status).toBe(200);
    expect(choices.body.data.map((r: any) => r.id)).toEqual(["empty-role-a", "staff-role-a"]);
    expect(choices.body.data.every((r: any) => !Object.hasOwn(r, "permissions"))).toBe(true);
  });
  it("creates, updates and deletes a tenant role with validated defaults and audit events", async () => {
    const created = await request("/role", "POST", { name: "Dispatch", permissionIds: ["read"] });
    expect(created.status).toBe(201);
    expect(created.body.data.organizationId).toBe("org-a");
    expect((await request("/role/new-role", "PATCH", { name: "Dispatch team", permissionIds: ["update"] })).status).toBe(200);
    expect(roleView(roles.find((r) => r.id === "new-role")!).permissions.map((g) => g.permission.id)).toEqual(["update"]);
    expect((await request("/role/new-role", "DELETE")).status).toBe(200);
    expect(record).toHaveBeenCalledTimes(3);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("rejects client organization IDs and duplicate permission IDs", async () => {
    expect((await request("/role", "POST", { name: "Spoof", organizationId: "org-b", permissionIds: [] })).status).toBe(400);
    expect((await request("/role", "POST", { name: "Dup", permissionIds: ["read", "read"] })).status).toBe(400);
  });
  it.each(["staff-role-b", "global-role"])("conceals foreign/platform role %s", async (id) => {
    expect((await request("/role/" + id)).status).toBe(404);
    expect((await request("/role/" + id, "PATCH", { name: "Hijack" })).status).toBe(404);
    expect((await request("/role/" + id, "DELETE")).status).toBe(404);
  });
  it("protects admin roles and reserved names", async () => {
    expect((await request("/role/admin-role-a", "PATCH", { permissionIds: [] })).status).toBe(403);
    expect((await request("/role/admin-role-a", "DELETE")).status).toBe(403);
    expect((await request("/role", "POST", { name: "Tenant_Admin", permissionIds: [] })).status).toBe(403);
  });
  it.each(["system", "unheld"])("rejects grants outside the allowlist or current authority: %s", async (id) => {
    expect((await request("/role", "POST", { name: "Escalation", permissionIds: [id] })).status).toBe(403);
    expect((await request("/user-permission/staff-a", "PATCH", { permissionIds: [id] })).status).toBe(403);
    expect(db.userPermission.updateMany).not.toHaveBeenCalled();
  });
  it("rejects foreign permission definitions and missing IDs without partial changes", async () => {
    expect((await request("/user-permission/staff-a", "PATCH", { permissionIds: ["read", "foreign"] })).status).toBe(400);
    expect((await request("/role/staff-role-a", "PATCH", { permissionIds: ["missing"] })).status).toBe(400);
    expect(db.userPermission.updateMany).not.toHaveBeenCalled();
    expect(db.rolePermission.updateMany).not.toHaveBeenCalled();
  });
  it("does not delete assigned roles, including roles assigned to deleted users", async () => {
    users.find((u) => u.id === "staff-a")!.deletedAt = new Date();
    expect((await request("/role/staff-role-a", "DELETE")).status).toBe(409);
    expect(db.role.delete).not.toHaveBeenCalled();
  });
  it("scopes direct grants and role assignment to tenant-owned users and roles", async () => {
    expect((await request("/user-permission/staff-b")).status).toBe(404);
    expect((await request("/user-permission/staff-b", "PATCH", { permissionIds: [] })).status).toBe(404);
    expect((await request("/users/staff-b/role", "PATCH", { roleId: "empty-role-a" })).status).toBe(404);
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "staff-role-b" })).status).toBe(404);
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "global-role" })).status).toBe(404);
  });
  it("prevents self-grants, self-role assignment and promotion into a protected role", async () => {
    expect((await request("/user-permission/admin-a", "PATCH", { permissionIds: ["read"] })).status).toBe(403);
    expect((await request("/users/admin-a/role", "PATCH", { roleId: "empty-role-a" })).status).toBe(403);
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "admin-role-a" })).status).toBe(403);
  });
  it("blocks assignment of an ordinary named role with grants beyond the admin's authority", async () => {
    roles.push({ id: "power-role-a", name: "Power", organizationId: "org-a", grants: [grant("unheld")] });
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "power-role-a" })).status).toBe(403);
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it("protects users with privileged direct grants from tenant permission edits and reassignment", async () => {
    users.find((u) => u.id === "staff-a")!.grants.push(grant("system"));
    expect((await request("/user-permission/staff-a")).body.data.protected).toBe(true);
    expect((await request("/user-permission/staff-a", "PATCH", { permissionIds: [] })).status).toBe(403);
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "empty-role-a" })).status).toBe(403);
  });
  it("does not expose foreign permission definitions through existing malformed nested grants", async () => {
    roles.find((r) => r.id === "staff-role-a")!.grants.push(grant("foreign"));
    users.find((u) => u.id === "staff-a")!.grants.push(grant("foreign"));
    const role = await request("/role/staff-role-a");
    const user = await request("/user-permission/staff-a");
    expect(role.body.data.protected).toBe(true);
    expect(user.body.data.protected).toBe(true);
    expect(JSON.stringify(role.body)).not.toContain(PERMISSIONS.INVOICE_DELETE);
    expect(JSON.stringify(user.body)).not.toContain(PERMISSIONS.INVOICE_DELETE);
  });
  it("preserves explicit platform authority while prohibiting platform self-grants", async () => {
    users.push({ id: "platform-user", roleId: "global-role", organizationId: null, platformRole: "SYSTEM_ADMIN", status: "ACTIVE", deletedAt: null, grants: [] });
    expect((await request("/user-permission/system-admin/staff-a", "PATCH", { permissionIds: ["update"], reason: "Approved access review", confirm: true }, "platform-user")).status).toBe(200);
    expect(users.find((u) => u.id === "staff-a")!.grants).toEqual([grant("update")]);
    expect((await request("/user-permission/system-admin/platform-user", "PATCH", { permissionIds: ["update"], reason: "Approved access review", confirm: true }, "platform-user")).status).toBe(403);
  });
  it("hides legacy platform permission grants from tenant sessions, role projections and permission detail without changing stored grants", async () => {
    permissions.push({ id: "system-read", name: PERMISSIONS.SYSTEM_ADMIN_READ, organizationId: null, description: "Legacy platform access" });
    roles.find((role) => role.id === "staff-role-a")!.grants.push(grant("system"), grant("system-read"));
    users.find((user) => user.id === "staff-a")!.grants.push(grant("system"), grant("system-read"));
    for (const response of [await request("/auth/me"), await request("/role/staff-role-a"), await request("/user-permission/staff-a")]) {
      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain(PERMISSIONS.SYSTEM_ADMIN_READ);
      expect(JSON.stringify(response.body)).not.toContain(PERMISSIONS.SYSTEM_ADMIN_UPDATE);
    }
    expect(users.find((user) => user.id === "staff-a")!.grants).toContainEqual(grant("system"));
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "empty-role-a" })).status).toBe(403);
  });
  it("validates platform account role ownership and keeps credentials out of output and audit", async () => {
    users.push({ id: "platform-user", roleId: "global-role", organizationId: null, platformRole: "SYSTEM_ADMIN", status: "ACTIVE", deletedAt: null, grants: [] });
    const input = { firstName: "Platform", lastName: "Admin", email: "new-platform@example.com", phone: "09171234567", password: "Password123", roleId: "global-role", reason: "Approved account creation", confirm: true };
    const created = await request("/system-admin", "POST", input, "platform-user");
    expect(created.status).toBe(201);
    expect(created.body.data).not.toHaveProperty("password");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ scope: "PLATFORM", metadata: expect.objectContaining({ after: expect.not.objectContaining({ password: expect.anything() }) }) }));
    expect((await request("/system-admin", "POST", { ...input, email: "another@example.com", roleId: "staff-role-b", organizationId: "org-b" }, "platform-user")).status).toBe(400);
    expect(db.user.create).toHaveBeenCalledTimes(1);
  });
  it("keeps user grants separate from role defaults and preserves inheritance on removal", async () => {
    expect((await request("/user-permission/staff-a", "PATCH", { permissionIds: ["update"] })).status).toBe(200);
    let detail = (await request("/user-permission/staff-a")).body.data;
    expect(detail.directPermissions.map((p: any) => p.id)).toEqual(["update"]);
    expect(detail.inheritedPermissions.map((p: any) => p.id)).toEqual(["read"]);
    expect((await request("/user-permission/staff-a", "PATCH", { permissionIds: [] })).status).toBe(200);
    detail = (await request("/user-permission/staff-a")).body.data;
    expect(detail.effectivePermissions).toEqual([PERMISSIONS.CUSTOMER_READ]);
    expect(db.rolePermission.updateMany).not.toHaveBeenCalled();
  });
  it("assigns a role without removing user overrides and enforces it with the old JWT", async () => {
    users.find((u) => u.id === "staff-a")!.grants = [grant("update")];
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(200);
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "empty-role-a" })).status).toBe(200);
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(403);
    const me = await request("/auth/me", "GET", undefined, "staff-a");
    expect(me.body.data.role).toBe("Empty");
    expect(me.body.data.permissions).toEqual([PERMISSIONS.CUSTOMER_UPDATE]);
  });
  it("enforces role-default revocations on the next request", async () => {
    expect((await request("/role/staff-role-a", "PATCH", { permissionIds: [] })).status).toBe(200);
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(403);
  });
  it("secures legacy permission endpoints against cross-tenant access and platform bypass", async () => {
    expect((await request("/role-permission/staff-role-b")).status).toBe(404);
    expect((await request("/role-permission", "POST", { roleId: "staff-role-b", permissionId: "read" })).status).toBe(404);
    expect((await request("/role-permission/staff-role-a", "PATCH", { permissions: ["system"] })).status).toBe(403);
    expect((await request("/user-permission/system-admin/staff-b", "PATCH", { permissionIds: ["system"] })).status).toBe(403);
    expect((await request("/permission", "POST", { name: "custom:admin", description: "Privilege" })).status).toBe(403);
    expect((await request("/system-admin", "POST", { firstName: "Escalated", lastName: "Admin", email: "evil@example.com", roleId: "global-role" })).status).toBe(403);
  });
  it("adds a legacy role grant without replacing other defaults", async () => {
    expect((await request("/role-permission", "POST", { roleId: "staff-role-a", permissionId: "update" })).status).toBe(201);
    expect(roleView(roles.find((r) => r.id === "staff-role-a")!).permissions.map((g) => g.permission.id)).toEqual(["read", "update"]);
  });
  it("requires explicit update payloads, instead of clearing permissions for a missing body", async () => {
    expect((await request("/user-permission/staff-a", "PATCH", {})).status).toBe(400);
    expect((await request("/role-permission/staff-role-a", "PATCH", {})).status).toBe(400);
  });
  it("returns only scoped grantable permissions and enforces deletion/inactive sessions", async () => {
    const response = await request("/permission");
    expect(response.body.data.map((p: any) => p.id)).toEqual(["read", "update"]);
    users.find((u) => u.id === "staff-a")!.deletedAt = new Date();
    expect((await request("/auth/me", "GET", undefined, "staff-a")).status).toBe(401);
    users.find((u) => u.id === "admin-a")!.status = "PENDING";
    expect((await request("/role")).status).toBe(401);
  });
});

describe("Tri-state staff permission overrides", () => {
  it.each([
    ["staff-role-a", "inherit", true], ["staff-role-a", "grant", true], ["staff-role-a", "deny", false],
    ["empty-role-a", "inherit", false], ["empty-role-a", "grant", true], ["empty-role-a", "deny", false],
  ] as const)("resolves %s with %s and enforces the effective result", async (roleId, state, effective) => {
    users.find((u) => u.id === "staff-a")!.roleId = roleId;
    const beforeRoles = structuredClone(roles);
    const response = await request("/user-permission/staff-a", "PATCH", { overrides: [{ permissionId: "read", state }] });
    expect(response.status).toBe(200);
    const detail = (await request("/user-permission/staff-a")).body.data;
    expect(detail.effectivePermissions.includes(PERMISSIONS.CUSTOMER_READ)).toBe(effective);
    expect(detail.email).toBe("staff-a@example.com");
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(effective ? 200 : 403);
    expect(roles).toEqual(beforeRoles);
  });
  it("removes a denial when restoring inherit and preserves unrelated overrides", async () => {
    expect((await request("/user-permission/staff-a", "PATCH", { overrides: [{ permissionId: "read", state: "deny" }, { permissionId: "update", state: "grant" }] })).status).toBe(200);
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(403);
    const reloaded = (await request("/user-permission/staff-a")).body.data;
    expect(reloaded.overrides).toEqual(expect.arrayContaining([expect.objectContaining({ permissionId: "read", isActive: false })]));
    expect((await request("/user-permission/staff-a", "PATCH", { overrides: [{ permissionId: "read", state: "inherit" }] })).status).toBe(200);
    expect(users.find((u) => u.id === "staff-a")!.grants).toEqual([grant("update")]);
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(200);
  });
  it.each(["grant", "deny", "inherit"])("enforces scope and authority for %s", async (state) => {
    expect((await request("/user-permission/staff-b", "PATCH", { overrides: [{ permissionId: "read", state }] })).status).toBe(404);
    for (const permissionId of ["system", "unheld"]) {
      expect((await request("/user-permission/staff-a", "PATCH", { overrides: [{ permissionId, state }] })).status).toBe(403);
    }
    expect((await request("/user-permission/staff-a", "PATCH", { overrides: [{ permissionId: "foreign", state }] })).status).toBe(400);
    expect(db.userPermission.upsert).not.toHaveBeenCalled();
    expect(db.userPermission.deleteMany).not.toHaveBeenCalled();
  });
  it("validates every batch item before writing and rejects duplicates, mixed payloads and invalid states", async () => {
    for (const body of [
      { overrides: [{ permissionId: "read", state: "deny" }, { permissionId: "missing", state: "grant" }] },
      { overrides: [{ permissionId: "read", state: "deny" }, { permissionId: "read", state: "inherit" }] },
      { overrides: [{ permissionId: "read", state: "invalid" }] },
      { overrides: [], permissionIds: [] }, { overrides: [] },
      { organizationId: "org-b", overrides: [{ permissionId: "read", state: "grant" }] },
    ]) expect((await request("/user-permission/staff-a", "PATCH", body)).status).toBe(400);
    expect(db.userPermission.upsert).not.toHaveBeenCalled();
    expect(db.userPermission.deleteMany).not.toHaveBeenCalled();
  });
  it("blocks staff self-management and applies a denial of the actor's update capability", async () => {
    const body = { overrides: [{ permissionId: "read", state: "grant" }] };
    expect((await request("/user-permission/staff-a", "PATCH", body, "staff-a")).status).toBe(403);
    users.find((u) => u.id === "admin-a")!.grants.push(grant("user-update", false));
    expect((await request("/user-permission/staff-a", "PATCH", body)).status).toBe(403);
  });
  it("keeps explicit denials across role assignments and ignores inactive role defaults", async () => {
    users.find((u) => u.id === "staff-a")!.grants = [grant("read", false)];
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "empty-role-a" })).status).toBe(200);
    expect((await request("/users/staff-a/role", "PATCH", { roleId: "staff-role-a" })).status).toBe(200);
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(403);
    roles.find((r) => r.id === "staff-role-a")!.grants[0].isActive = false;
    expect((await request("/user-permission/staff-a", "PATCH", { overrides: [{ permissionId: "read", state: "inherit" }] })).status).toBe(200);
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(403);
  });
  it("records override state in the transaction and rolls back if auditing fails", async () => {
    record.mockRejectedValueOnce(new Error("Audit unavailable"));
    expect((await request("/user-permission/staff-a", "PATCH", { overrides: [{ permissionId: "read", state: "deny" }] })).status).toBe(500);
    expect(users.find((u) => u.id === "staff-a")!.grants).toEqual([]);
    expect((await request("/user-permission/staff-a", "PATCH", { overrides: [{ permissionId: "read", state: "deny" }] })).status).toBe(200);
    expect(record).toHaveBeenLastCalledWith(expect.objectContaining({ action: "update.user.permissions.success", before: [], after: [{ permissionId: "read", isActive: false }] }));
  });
  it("returns override-aware legacy user lists and resolves denials during login and refresh", async () => {
    users.find((u) => u.id === "staff-a")!.grants = [grant("read", false), grant("update")];
    const list = await userService.listForPermissionManagement("org-a");
    expect(list.find((u) => u.id === "staff-a")!.permissions).toEqual([PERMISSIONS.CUSTOMER_UPDATE]);
    await authService.login("staff-a@example.com", "password");
    expect(generateAccessToken).toHaveBeenLastCalledWith(expect.objectContaining({ permissions: [PERMISSIONS.CUSTOMER_UPDATE] }));
    await authService.refresh("old-refresh");
    expect(generateAccessToken).toHaveBeenLastCalledWith(expect.objectContaining({ permissions: [PERMISSIONS.CUSTOMER_UPDATE] }));
  });
  it("keeps legacy grant replacement callers from silently removing explicit denials", async () => {
    users.find((u) => u.id === "staff-a")!.grants = [grant("read", false), grant("update")];
    expect((await request("/user-permission/staff-a", "PATCH", { permissionIds: [] })).status).toBe(200);
    expect(users.find((u) => u.id === "staff-a")!.grants).toEqual([grant("read", false)]);
    expect((await request("/probe", "GET", undefined, "staff-a")).status).toBe(403);
  });
});

describe("Authentication and invitation integration", () => {
  it("returns a safe 409 from the invitation route when the third user already fills the plan", async () => {
    billingEnabled = true;
    const body = { firstName: "New", lastName: "User", email: "new@example.com", roleId: "staff-role-a" };
    const final = await request("/users/invite-email", "POST", body);
    expect(final.status).toBe(201);
    expect(final.body.data).toMatchObject({ status: "PENDING", organizationId: "org-a" });
    const excess = await request("/users/invite-email", "POST", { ...body, email: "excess@example.com" });
    expect(excess.status).toBe(409);
    expect(excess.body.error).toContain("maximum 3, including pending invitations");
    expect(db.user.create).toHaveBeenCalledTimes(1);
    // Direct creation cannot bypass an invitation's reservation either.
    expect((await request("/users", "POST", { ...body, email: "direct@example.com", password: "Password123!" })).status).toBe(409);
  });
  it("retains tenant authorization and related-role ownership on the invitation route", async () => {
    billingEnabled = true;
    const body = { firstName: "New", lastName: "User", email: "new@example.com", roleId: "staff-role-a" };
    expect((await request("/users/invite-email", "POST", body, "staff-a")).status).toBe(403);
    expect((await request("/users/invite-email", "POST", { ...body, roleId: "staff-role-b" })).status).toBe(404);
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it("rejects role/tenant assignment through public registration", async () => {
    expect((await request("/auth/register", "POST", { email: "new@example.com", password: "Password123", firstName: "New", lastName: "User", role: "global-role", organizationId: "org-b" })).status).toBe(400);
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it("excludes inactive direct grants during login and refresh", async () => {
    users.find((u) => u.id === "staff-a")!.grants = [grant("update", false)];
    await authService.login("staff-a@example.com", "password");
    expect(generateAccessToken).toHaveBeenLastCalledWith(expect.objectContaining({ permissions: [PERMISSIONS.CUSTOMER_READ] }));
    await authService.refresh("old-refresh");
    expect(generateAccessToken).toHaveBeenLastCalledWith(expect.objectContaining({ permissions: [PERMISSIONS.CUSTOMER_READ] }));
    expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ userPermissions: expect.objectContaining({ select: expect.objectContaining({ isActive: true }) }) }) }));
  });
  it("uses the current assigned role and permissions on refresh", async () => {
    users.find((u) => u.id === "staff-a")!.roleId = "empty-role-a";
    await authService.refresh("old-refresh");
    expect(generateAccessToken).toHaveBeenLastCalledWith(expect.objectContaining({ role: "Empty", permissions: [] }));
  });
  it("blocks role assignment bypass through invitation and direct creation", async () => {
    // Validate assignment inside the service before creation, using server-side organization context.
    const input = { firstName: "New", lastName: "User", email: "new@example.com", roleId: "global-role", organizationId: "org-b", password: "password" };
    // Normal request context: a scoped lookup must reject a foreign role for both creation paths.
    await expect(requestContext.run({ requestId: "test", userId: "admin-a", organizationId: "org-a" }, () => userService.createWithInvite(input))).rejects.toMatchObject({ statusCode: 404 });
    await expect(requestContext.run({ requestId: "test", userId: "admin-a", organizationId: "org-a" }, () => userService.createDirect(input))).rejects.toMatchObject({ statusCode: 404 });
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it("creates invited users with a scoped assignable role and excludes secrets from responses and audits", async () => {
    const result = await requestContext.run({ requestId: "test", userId: "admin-a", organizationId: "org-a" }, () => userService.createWithInvite({ firstName: "New", lastName: "User", email: "new@example.com", roleId: "staff-role-a", organizationId: "org-b" }));
    expect(db.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organization: { connect: { id: "org-a" } } }) }));
    expect(result).not.toHaveProperty("inviteToken");
    expect(result).not.toHaveProperty("password");
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ after: expect.not.objectContaining({ inviteToken: expect.anything() }) }));
  });
});
