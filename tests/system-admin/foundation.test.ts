import { jest } from "@jest/globals";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";

type Row = Record<string, any>;
let users: Row[];
let organizations: Row[];
let tokens: Row[];
let audits: Row[];
let challenges: Row[];
let codes: string[];
let permissions: Row[];
let platformSettings: Row | null;
let failAudit = false;
const password = "Original123!";
const passwordHash = await bcrypt.hash(password, 4);
const grant = { permission: { id: "system", name: "system_admin:update", organizationId: null } };
function reset() {
  challenges = []; codes = [];
  platformSettings = null;
  organizations = ["a", "b"].map((key) => ({ id: "org-" + key, name: "Tenant " + key, slug: key, status: "ACTIVE", billingEnabled: false, createdAt: new Date(), updatedAt: new Date(), statusReason: null, statusChangedAt: null, statusChangedBy: null, _count: { users: 1, customers: 0, serviceRequests: 0 } }));
  users = [
    { id: "platform", organizationId: null, platformRole: "SYSTEM_ADMIN", roleName: "Ordinary global role" },
    { id: "admin-a", organizationId: "org-a", platformRole: "NONE", roleName: "Admin" },
    { id: "staff-b", organizationId: "org-b", platformRole: "NONE", roleName: "Staff" },
    { id: "legacy-global", organizationId: null, platformRole: "NONE", roleName: "SYSTEM_ADMIN" },
  ].map((row) => ({ ...row, email: row.id + "@example.invalid", password: passwordHash, firstName: row.id, lastName: "Test", status: "ACTIVE", securityStatus: "ACTIVE", sessionVersion: 0, deletedAt: null, inviteToken: "private-invite", createdAt: new Date(), updatedAt: new Date(), userPermissions: [], role: { id: row.id + "-role", name: row.roleName, organizationId: row.organizationId, deletedAt: null, permissions: [grant] } }));
  tokens = [{ id: "refresh-a", token: "refresh-a", userId: "admin-a", organizationId: "org-a", expiresAt: new Date(Date.now() + 60000) }, { id: "refresh-b", token: "refresh-b", userId: "staff-b", organizationId: "org-b", expiresAt: new Date(Date.now() + 60000) }];
  audits = [{ id: "tenant-audit", scope: "TENANT", organizationId: "org-a", action: "private.tenant.action" }];
  failAudit = false;
  permissions = [{ id: "read", name: "customer:read", description: "Customer access", organizationId: null }];
}
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === "OR") return value.some((part: Row) => matches(row, part));
    if (key === "AND") return value.every((part: Row) => matches(row, part));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("not" in value) return row[key] !== value.not;
      if ("contains" in value) return String(row[key]).toLowerCase().includes(value.contains.toLowerCase());
      if ("gt" in value) return row[key] > value.gt;
      if ("in" in value) return value.in.includes(row[key]);
    }
    return row[key] === value;
  });
}
function view(row: Row): Row {
  return { ...row, organization: organizations.find((org) => org.id === row.organizationId) ?? null };
}
function select(row: Row, selection?: Row): Row {
  if (!selection) return row;
  return Object.fromEntries(Object.entries(selection).map(([key, value]: [string, any]) => [key, value === true ? row[key] : row[key] == null ? row[key] : Array.isArray(row[key]) ? row[key].map((part: Row) => select(part, value.select)) : select(row[key], value.select)]));
}
function update(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value;
}
const db: any = {
  trustedDevice: {
    updateMany: jest.fn(async (_input: unknown) => ({ count: 0 })),
    findFirst: jest.fn(async () => ({ id: "verified-fixture-device" })),
    update: jest.fn(async () => ({ id: "verified-fixture-device" })),
    create: jest.fn(async ({ data }: Row) => ({ id: "new-trusted-device", ...data })),
  },
  loginChallenge: {
    findUnique: jest.fn(async ({ where }: Row) => challenges.find(row => matches(row, where)) ?? null),
    findFirst: jest.fn(async ({ where }: Row) => challenges.filter(row => matches(row, where)).at(-1) ?? null),
    count: jest.fn(async ({ where }: Row) => challenges.filter(row => matches(row, where)).length),
    create: jest.fn(async ({ data }: Row) => { const row = { id: "challenge-" + challenges.length, consumedAt: null, ...data }; challenges.push(row); return row; }),
    updateMany: jest.fn(async ({ where, data }: Row) => { const found = challenges.filter(row => matches(row, where)); found.forEach(row => update(row, data)); return { count: found.length }; }),
  },
  user: {
    create: jest.fn(async ({ data }: Row) => { const row = { id: "new-user", securityStatus: "ACTIVE", sessionVersion: 0, deletedAt: null, ...data }; users.push(row); return row; }),
    findUnique: jest.fn(async ({ where, select: fields }: Row) => { const row = users.find((u) => matches(u, where)); return row ? select(view(row), fields) : null; }),
    findFirst: jest.fn(async ({ where, select: fields }: Row) => { const row = users.find((u) => matches(u, where)); return row ? select(view(row), fields) : null; }),
    count: jest.fn(async ({ where }: Row) => users.filter((u) => matches(u, where)).length),
    findMany: jest.fn(async ({ where, select: fields, skip = 0, take }: Row) => users.filter((u) => matches(u, where)).slice(skip, skip + take).map((u) => select(view(u), fields))),
    update: jest.fn(async ({ where, data, select: fields }: Row) => { const row = users.find((u) => matches(u, where)); if (!row) throw new Error("Missing update target"); update(row, data); return select(view(row), fields); }),
    updateMany: jest.fn(async ({ where, data }: Row) => { const rows = users.filter((u) => matches(u, where)); rows.forEach((u) => update(u, data)); return { count: rows.length }; }),
  },
  organization: {
    create: jest.fn(async ({ data }: Row) => { const row = { id: "new-org", status: "ACTIVE", billingEnabled: false, ...data }; organizations.push(row); return row; }),
    findUnique: jest.fn(async ({ where, select: fields }: Row) => { const row = organizations.find((o) => matches(o, where)); return row ? select(row, fields) : null; }),
    count: jest.fn(async ({ where }: Row) => organizations.filter((o) => matches(o, where)).length),
    findMany: jest.fn(async ({ where, select: fields, skip = 0, take }: Row) => organizations.filter((o) => matches(o, where)).slice(skip, skip + take).map((o) => select(o, fields))),
    update: jest.fn(async ({ where, data, select: fields }: Row) => { const row = organizations.find((o) => matches(o, where))!; update(row, data); return select(row, fields); }),
  },
  role: { findFirst: jest.fn(async ({ where }: Row) => users.map((user) => user.role).find((role) => role && matches(role, where)) ?? null) },
  permission: {
    findUnique: jest.fn(async ({ where }: Row) => permissions.find((permission) => matches(permission, where)) ?? null),
    findMany: jest.fn(async ({ where }: Row) => permissions.filter((permission) => matches(permission, where))),
    create: jest.fn(async ({ data }: Row) => { const permission = { id: "new-permission", organizationId: null, ...data }; permissions.push(permission); return permission; }),
  },
  userPermission: {
    deleteMany: jest.fn(async ({ where }: Row) => { const user = users.find((user) => user.id === where.userId)!; user.userPermissions = user.userPermissions.filter((grant: Row) => !matches(grant, { ...(where.permissionId ? { permissionId: where.permissionId } : {}), ...(where.isActive === undefined ? {} : { isActive: where.isActive }) })); }),
    upsert: jest.fn(async ({ create }: Row) => { const user = users.find((user) => user.id === create.userId)!; const grant = user.userPermissions.find((grant: Row) => grant.permissionId === create.permissionId); if (grant) Object.assign(grant, create); else user.userPermissions.push({ ...create, permission: permissions.find((permission) => permission.id === create.permissionId) }); }),
    findMany: jest.fn(async ({ where }: Row) => users.find((user) => user.id === where.userId)!.userPermissions),
  },
  refreshToken: {
    findUnique: jest.fn(async ({ where }: Row) => tokens.find((token) => matches(token, where)) ?? null),
    create: jest.fn(async ({ data }: Row) => { const token = { id: "new-refresh-" + tokens.length, ...data }; tokens.push(token); return token; }),
    delete: jest.fn(async ({ where }: Row) => { tokens = tokens.filter((token) => !matches(token, where)); return {}; }),
    deleteMany: jest.fn(async ({ where }: Row) => { const count = tokens.filter((token) => matches(token, where)).length; tokens = tokens.filter((token) => !matches(token, where)); return { count }; }),
    count: jest.fn(async ({ where }: Row) => tokens.filter((token) => matches(token, where)).length),
  },
  auditLog: {
    create: jest.fn(async ({ data }: Row) => { if (failAudit) throw new Error("Audit unavailable"); const row = { id: "audit-" + audits.length, createdAt: new Date(), actor: null, ...data }; audits.push(row); return row; }),
    count: jest.fn(async ({ where }: Row) => audits.filter((a) => matches(a, where)).length),
    findMany: jest.fn(async ({ where, select: fields, skip = 0, take }: Row) => audits.filter((a) => matches(a, where)).slice(skip, skip + take).map((a) => select(a, fields))),
  },
  subscription: { findUnique: jest.fn(async ({ where }: Row) => organizations.find((org) => org.id === where.organizationId)?.subscription ?? null) },
  platformSettings: { findUnique: jest.fn(async () => platformSettings) },
  $queryRaw: jest.fn(async (_strings: TemplateStringsArray, id: string) => organizations.filter((o) => o.id === id).map((o) => ({ id: o.id }))),
  $transaction: jest.fn(async (work: (tx: any) => Promise<unknown>) => {
    const saved = structuredClone({ users, organizations, tokens, audits, permissions, challenges });
    try { return await work(db); } catch (error) { ({ users, organizations, tokens, audits, permissions, challenges } = saved); throw error; }
  }),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { SALT_ROUNDS: 4, ACCESS_TOKEN_EXPIRY: 900, NODE_ENV: "test", JWT_ACCESS_SECRET: "fixture-secret-at-least-32-characters" } }));
jest.unstable_mockModule("@/lib/email/send-login-code", () => ({ sendLoginCodeEmail: async (_to: string, _name: string, code: string) => { codes.push(code); } }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn(async () => {}) }));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => { const pass = (_req: unknown, _res: unknown, next: () => void) => next(); return { apiLimiter: pass, publicApiLimiter: pass, writeLimmiter: pass, brandingAssetLimiter: pass, brandingUploadLimiter: pass, publicPageLimiter: pass }; });
jest.unstable_mockModule("@/utils/tokens.js", () => ({
  verifyAccessToken: (token: string) => ({ sub: token.split("#")[0], sessionVersion: Number(token.split("#")[1] ?? 0), role: "SYSTEM_ADMIN", platformRole: "SYSTEM_ADMIN", organizationId: "org-b", permissions: ["system_admin:update"] }),
  generateAccessToken: (user: Row) => user.id + "#" + user.sessionVersion,
  generateRefreshTokenValue: () => "opaque-" + tokens.length, hashToken: (value: string) => value, getRefreshExpiry: () => new Date(Date.now() + 60000), REFRESH_TOKEN_DAYS: 7,
}));
const { default: routes } = await import("@/modules/system-admin/foundation.routes.js");
const { default: organizationRoutes } = await import("@/modules/organization/organization.route.js");
const { default: permissionRoutes } = await import("@/modules/permission/permission.route.js");
const { default: legacyAdminRoutes } = await import("@/modules/user/routes/system-admin.routes.js");
const { default: userPermissionRoutes } = await import("@/modules/user-permission/user.permission.routes.js");
const { authenticate } = await import("@/middleware/auth.js");
const { requireSystemAdmin } = await import("@/middleware/require-platform-admin.js");
const { authController } = await import("@/modules/auth/auth.controller.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { validate } = await import("@/middleware/validate");
const { verifyTwoFactorSchema } = await import("@/modules/auth/auth.schema");
let server: Server;
let origin: string;
beforeAll(async () => {
  const app = express(); app.use(express.json(), cookieParser(), withRequestContext);
  app.use("/system-admin", authenticate, requireSystemAdmin, routes); app.use("/organization", organizationRoutes);
  app.use("/permission", permissionRoutes); app.use("/legacy-admin", authenticate, legacyAdminRoutes); app.use("/user-permission", userPermissionRoutes);
  app.get("/probe", authenticate, (req, res) => res.json(req.user));
  app.post("/auth/login", authController.login); app.post("/auth/refresh", authController.refresh); app.post("/auth/logout", authController.logout);
  app.post("/auth/2fa/verify", validate(verifyTwoFactorSchema), authController.verifyTwoFactor);
  app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" })) as express.ErrorRequestHandler);
  server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No listener");
  origin = "http://127.0.0.1:" + address.port;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => { reset(); jest.clearAllMocks(); });
async function request(path: string, method = "GET", body?: unknown, token: string | null = "platform", cookie?: string) {
  const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Row, cookie: response.headers.get("set-cookie") };
}
const reason = { reason: "Operator reviewed the account", confirm: true };
const legacyMutations = [
  { name: "organization creation", path: "/organization", method: "POST", body: { name: "New tenant", slug: "new-tenant" }, action: "platform.organization.create" },
  { name: "permission creation", path: "/permission", method: "POST", body: { name: "custom:read", description: "Custom capability" }, action: "platform.permission.create" },
  { name: "ordinary account creation", path: "/legacy-admin", method: "POST", body: { firstName: "Ordinary", lastName: "Account", email: "new@example.invalid", phone: "09171234567", password, roleId: "platform-role" }, action: "platform.ordinary-account.create" },
  { name: "platform permission override", path: "/user-permission/system-admin/admin-a", method: "PATCH", body: { permissionIds: ["read"] }, action: "update.platform.user.permissions.success" },
];
test.each(legacyMutations)("$name requires confirmation and a validated reason and rejects mass assignment", async (mutation) => {
  for (const body of [{ ...mutation.body }, { ...mutation.body, ...reason, confirm: false }, { ...mutation.body, ...reason, reason: "" }, { ...mutation.body, ...reason, billingEnabled: true, platformRole: "SYSTEM_ADMIN" }]) {
    expect((await request(mutation.path, mutation.method, body)).status).toBe(400);
  }
  expect(db.organization.create).not.toHaveBeenCalled(); expect(db.permission.create).not.toHaveBeenCalled();
  expect(db.user.create).not.toHaveBeenCalled(); expect(db.userPermission.upsert).not.toHaveBeenCalled();
});
test.each(legacyMutations)("$name writes an attributed PLATFORM audit and persists only permitted input fields", async (mutation) => {
  const response = await request(mutation.path, mutation.method, { ...mutation.body, ...reason });
  expect(response.status).toBe(mutation.method === "PATCH" ? 200 : 201);
  const event = audits.at(-1)!;
  expect(event).toMatchObject({ scope: "PLATFORM", actorType: "SYSTEM_ADMIN", actorId: "platform", action: mutation.action });
  expect(event.metadata.after.reason).toBe(reason.reason);
  for (const model of [db.organization, db.permission, db.user]) {
    if (model.create.mock.calls.length) {
      const data = model.create.mock.calls.at(-1)[0].data;
      expect(data).not.toHaveProperty("reason"); expect(data).not.toHaveProperty("confirm");
    }
  }
  expect(JSON.stringify(event)).not.toContain(password); expect(JSON.stringify(event)).not.toContain(passwordHash);
  if (mutation.path === "/legacy-admin") expect(response.body.data).toMatchObject({ organizationId: null, platformRole: "NONE" });
});
test.each(legacyMutations)("$name rolls back its write when the immutable audit append fails", async (mutation) => {
  const before = structuredClone({ users, organizations, permissions, tokens, audits }); failAudit = true;
  expect((await request(mutation.path, mutation.method, { ...mutation.body, ...reason })).status).toBe(500);
  expect({ users, organizations, permissions, tokens, audits }).toEqual(before);
});
test("persisted platform authority works without tenant grants or a privileged role name", async () => {
  users[0].role.permissions = []; users[0].role.deletedAt = new Date();
  expect((await request("/system-admin/tenants")).status).toBe(200);
  expect((await request("/probe")).body).toMatchObject({ id: "platform", platformRole: "SYSTEM_ADMIN", permissions: [] });
});
test.each(["/system-admin/tenants", "/system-admin/users", "/system-admin/audit-logs", "/organization"])("tenant forged JWT grants cannot reach platform API %s", async (path) => {
  expect((await request(path, "GET", undefined, "admin-a")).status).toBe(403);
  expect((await request(path, "GET", undefined, "legacy-global")).status).toBe(401);
  expect((await request(path, "GET", undefined, null)).status).toBe(401);
});
test("public organization creation is protected and cross-tenant details are denied", async () => {
  expect((await request("/organization", "POST", { name: "Unsafe", slug: "unsafe" }, null)).status).toBe(401);
  expect((await request("/organization/by-id/org-b", "GET", undefined, "admin-a")).status).toBe(403);
});
test.each(["SUSPENDED", "ARCHIVED", "INACTIVE"])("tenant %s denies login, refresh and protected access", async (status) => {
  organizations[0].status = status;
  expect((await request("/probe", "GET", undefined, "admin-a")).status).toBe(401);
  expect((await request("/auth/login", "POST", { email: users[1].email, password }, null)).status).toBe(401);
  expect((await request("/auth/refresh", "POST", {}, null, "refreshToken=refresh-a")).status).toBe(401);
});
test("blocked accounts cannot login, refresh or access protected endpoints", async () => {
  users[1].securityStatus = "BLOCKED";
  expect((await request("/probe", "GET", undefined, "admin-a")).status).toBe(401);
  expect((await request("/auth/login", "POST", { email: users[1].email, password }, null)).status).toBe(401);
  expect((await request("/auth/refresh", "POST", {}, null, "refreshToken=refresh-a")).status).toBe(401);
});
test("untrusted login issues no session; the challenge cannot authorize protected routes or refresh", async () => {
  const before = tokens.length;
  const result = await request("/auth/login", "POST", { email: users[0].email, password }, null);
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ requiresTwoFactor: true, deliveryStatus: "sent", codeLength: 4, trustedDeviceDays: 7 });
  expect(result.body.data).not.toHaveProperty("accessToken"); expect(result.body.data).not.toHaveProperty("refreshToken");
  expect(tokens).toHaveLength(before);
  expect(result.cookie).not.toMatch(/refreshToken=[^;]/);
  const handle = result.body.data.challengeId;
  expect((await request("/probe", "GET", undefined, handle)).status).toBe(401);
  expect((await request("/auth/refresh", "POST", {}, null, "refreshToken=" + handle)).status).toBe(401);
  const verified = await request("/auth/2fa/verify", "POST", { challengeId: handle, code: codes[0], rememberDevice: true }, null);
  expect(verified.status).toBe(200); expect(verified.body.data.user.platformRole).toBe("SYSTEM_ADMIN");
  expect(verified.body.data).not.toHaveProperty("trustedDevice"); expect(verified.body.data).not.toHaveProperty("refreshToken");
  expect(verified.cookie).toContain("trustedDeviceAdmin="); expect(verified.cookie).toContain("HttpOnly");
  expect(verified.cookie).toContain("SameSite=Strict"); expect(tokens).toHaveLength(before + 1);
  expect((await request("/auth/2fa/verify", "POST", { challengeId: handle, code: codes[0] }, null)).status).toBe(400);
});
test("login hides refresh tokens, scopes cookies to auth and audits only minimal identity data", async () => {
  const result = await request("/auth/login", "POST", { email: users[0].email, password }, null, "trustedDeviceAdmin=verified-fixture-device");
  expect(result.status).toBe(200); expect(result.body.data.user.platformRole).toBe("SYSTEM_ADMIN");
  expect(result.body.data).not.toHaveProperty("refreshToken"); expect(result.cookie).toContain("HttpOnly"); expect(result.cookie).toContain("Path=/api/auth");
  const event = audits.find((a) => a.action === "auth.login.success")!;
  expect(event).toMatchObject({ scope: "PLATFORM", actorId: "platform", actorType: "SYSTEM_ADMIN" });
  for (const secret of [passwordHash, password, "private-invite", "opaque-"]) expect(JSON.stringify(event)).not.toContain(secret);
  expect((await request("/auth/logout", "POST", {}, null, "refreshToken=" + tokens.at(-1)!.token)).cookie).toContain("Path=/api/auth/refresh");
});
test("failed credentials produce a sanitized platform audit without identifying unknown accounts", async () => {
  const result = await request("/auth/login", "POST", { email: "unknown@example.invalid", password }, null);
  expect(result.status).toBe(401);
  expect(audits.at(-1)).toMatchObject({ action: "auth.login.failure", scope: "PLATFORM", actorType: "SYSTEM", entityId: "unknown" });
  expect(JSON.stringify(audits)).not.toContain("unknown@example.invalid");
});
test("tenant login identifies its actor and tenant without granting platform authority", async () => {
  expect((await request("/auth/login", "POST", { email: users[1].email, password }, null, "trustedDeviceTenant=verified-fixture-device")).status).toBe(200);
  expect(audits.at(-1)).toMatchObject({ scope: "PLATFORM", actorId: "admin-a", actorType: "USER", organizationId: "org-a" });
});
test("billing enabled tenants without a current subscription cannot authenticate or use a refresh session", async () => {
  organizations[0].billingEnabled = true;
  expect((await request("/probe", "GET", undefined, "admin-a")).status).toBe(403);
  expect((await request("/auth/login", "POST", { email: users[1].email, password }, null)).status).toBe(403);
  expect((await request("/auth/refresh", "POST", {}, null, "refreshToken=refresh-a")).status).toBe(403);
});

function assignSummarySubscription(status = "ACTIVE") {
  organizations[0].billingEnabled = true;
  organizations[0].subscription = {
    status, startsAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() + 86_400_000),
    trialStartedAt: null, trialExpiresAt: null, price: 299, currency: "PHP", billingInterval: "MONTHLY",
    plan: { name: "Starter Monthly", maxActiveUsers: 3, internalField: "private-plan-data" },
    currentPeriodPaymentId: "private-payment", history: [{ reason: "private-platform-note" }],
  };
  return organizations[0].subscription;
}

test("subscription summary scopes tenant and seat reads to the authenticated admin, ignoring forged JWT tenant claims", async () => {
  assignSummarySubscription();
  const result = await request("/organization/subscription", "GET", undefined, "admin-a");
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ organizationName: "Tenant a", billingEnabled: true, accessAllowed: true, activeUsers: 1,
    userCapacity: { used: 1, limit: 3, remaining: 2, canAdd: true },
    subscription: { status: "ACTIVE", effectiveStatus: "ACTIVE", price: "299.00", billingInterval: "MONTHLY", plan: { name: "Starter Monthly", maxActiveUsers: 3 } } });
  expect(db.user.count).toHaveBeenCalledWith({ where: { organizationId: "org-a", status: "ACTIVE", deletedAt: null, platformRole: "NONE" } });
  for (const secret of ["private-payment", "private-platform-note", "private-plan-data", "Tenant b"]) expect(JSON.stringify(result.body)).not.toContain(secret);
  users[2].role.name = "Tenant Admin";
  const otherTenant = await request("/organization/subscription", "GET", undefined, "staff-b");
  expect(otherTenant.status).toBe(200);
  expect(otherTenant.body.data).toMatchObject({ organizationName: "Tenant b", subscription: null, accessAllowed: true });
  expect(JSON.stringify(otherTenant.body)).not.toContain("Starter Monthly");
});

test("user availability reserves pending invitations, counts blocked users and excludes deleted and foreign accounts", async () => {
  assignSummarySubscription();
  const owner = users[1];
  users.push({ ...owner, id: "pending-a", status: "PENDING" },
    { ...owner, id: "blocked-a", securityStatus: "BLOCKED" },
    { ...owner, id: "deleted-a", deletedAt: new Date() },
    { ...owner, id: "platform-a", platformRole: "SYSTEM_ADMIN" },
    { ...owner, id: "pending-b", organizationId: "org-b", status: "PENDING" });
  const full = await request("/organization/subscription", "GET", undefined, "admin-a");
  expect(full.status).toBe(200);
  expect(full.body.data).toMatchObject({ activeUsers: 2, userCapacity: { used: 3, limit: 3, remaining: 0, canAdd: false } });
  users.find((user) => user.id === "pending-a")!.deletedAt = new Date();
  const freed = await request("/organization/subscription", "GET", undefined, "admin-a");
  expect(freed.body.data.userCapacity).toEqual({ used: 2, limit: 3, remaining: 1, canAdd: true });
});

test("user availability reports legacy excess users and immediately reflects plan upgrades", async () => {
  const subscription = assignSummarySubscription();
  users.push(...[1, 2, 3].map((index) => ({ ...users[1], id: `pending-${index}`, status: "PENDING" })));
  expect((await request("/organization/subscription", "GET", undefined, "admin-a")).body.data.userCapacity)
    .toEqual({ used: 4, limit: 3, remaining: 0, canAdd: false });
  subscription.plan.maxActiveUsers = 5;
  expect((await request("/organization/subscription", "GET", undefined, "admin-a")).body.data.userCapacity)
    .toEqual({ used: 4, limit: 5, remaining: 1, canAdd: true });
});

test("subscription summary denies staff, platform identities, unauthenticated users and revoked sessions", async () => {
  for (const [token, status] of [["staff-b", 403], ["platform", 403], [null, 401], ["admin-a#1", 401]] as const) {
    expect((await request("/organization/subscription", "GET", undefined, token)).status).toBe(status);
  }
  expect(db.user.count).not.toHaveBeenCalled();
});

test.each(["organizationId=org-b", "subscriptionId=foreign", "status=ACTIVE"])("subscription summary rejects client selectors: %s", async (query) => {
  expect((await request("/organization/subscription?" + query, "GET", undefined, "admin-a")).status).toBe(400);
  expect(db.user.count).not.toHaveBeenCalled();
});

test("legacy organization summary distinguishes missing subscription from missing tenant", async () => {
  const result = await request("/organization/subscription", "GET", undefined, "admin-a");
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ billingEnabled: false, subscription: null, accessAllowed: true, graceEndsAt: null,
    userCapacity: { used: 1, limit: null, remaining: null, canAdd: true } });
});

test("trial summaries expose trial dates and expiry still denies protected access", async () => {
  const subscription = assignSummarySubscription("TRIALING");
  subscription.trialStartedAt = subscription.startsAt;
  subscription.trialExpiresAt = subscription.expiresAt;
  const result = await request("/organization/subscription", "GET", undefined, "admin-a");
  expect(result.status).toBe(200);
  expect(result.body.data.subscription).toMatchObject({ effectiveStatus: "TRIALING", trialExpiresAt: subscription.trialExpiresAt.toISOString() });
  subscription.trialExpiresAt = subscription.expiresAt = new Date(Date.now() - 1000);
  expect((await request("/organization/subscription", "GET", undefined, "admin-a")).status).toBe(403);
});

test("past-due summary reports server-configured grace and denies access when grace ends", async () => {
  const subscription = assignSummarySubscription("PAST_DUE");
  subscription.expiresAt = new Date(Date.now() - 1000);
  platformSettings = { gracePeriodDays: 2 };
  const result = await request("/organization/subscription", "GET", undefined, "admin-a");
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ accessAllowed: true, graceEndsAt: new Date(+subscription.expiresAt + 2 * 86_400_000).toISOString(), subscription: { effectiveStatus: "PAST_DUE" } });
  platformSettings.gracePeriodDays = 0;
  expect((await request("/organization/subscription", "GET", undefined, "admin-a")).status).toBe(403);
});

test("subscription summary does not display stale active status for expired legacy coverage", async () => {
  const subscription = assignSummarySubscription();
  organizations[0].billingEnabled = false;
  subscription.expiresAt = new Date(Date.now() - 1000);
  const result = await request("/organization/subscription", "GET", undefined, "admin-a");
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ accessAllowed: true, subscription: { status: "ACTIVE", effectiveStatus: "EXPIRED" } });
});
test("logout revokes the presented refresh session and immediately invalidates existing access JWTs with an attributed audit", async () => {
  expect((await request("/auth/logout", "POST", {}, null, "refreshToken=refresh-a")).status).toBe(200);
  expect((await request("/probe", "GET", undefined, "admin-a#0")).status).toBe(401);
  expect(tokens.map((token) => token.userId)).toEqual(["staff-b"]);
  expect(audits.at(-1)).toMatchObject({ action: "auth.logout.success", actorId: "admin-a", actorType: "USER", organizationId: "org-a" });
  expect(JSON.stringify(audits.at(-1))).not.toContain("refresh-a");
});
test("failed logout auditing rolls back session and token revocation", async () => {
  const before = structuredClone({ users, tokens }); failAudit = true;
  expect((await request("/auth/logout", "POST", {}, null, "refreshToken=refresh-a")).status).toBe(500);
  expect({ users, tokens }).toEqual(before);
});
test("tenant suspension revokes its sessions, preserves data and leaves other tenants active", async () => {
  const result = await request("/system-admin/tenants/org-a/status", "POST", { ...reason, status: "SUSPENDED" });
  expect(result.status).toBe(200); expect(users[1].sessionVersion).toBe(1); expect(tokens.map((t) => t.userId)).toEqual(["staff-b"]);
  expect((await request("/probe", "GET", undefined, "staff-b")).status).toBe(200);
  expect(audits.at(-1)).toMatchObject({ scope: "PLATFORM", action: "tenant.status.changed", organizationId: "org-a" });
});
test("block and unblock keep invitation status separate and revoke access versions immediately", async () => {
  users[1].status = "PENDING";
  expect((await request("/system-admin/users/admin-a/security", "POST", { ...reason, securityStatus: "BLOCKED" })).status).toBe(200);
  expect(users[1]).toMatchObject({ status: "PENDING", securityStatus: "BLOCKED", sessionVersion: 1 });
  expect((await request("/system-admin/users/admin-a/security", "POST", { ...reason, securityStatus: "ACTIVE" })).status).toBe(200);
  expect(users[1].status).toBe("PENDING"); expect(users[1].sessionVersion).toBe(2);
});
test("explicit session revocation rejects old access tokens and refresh tokens", async () => {
  expect((await request("/system-admin/users/admin-a/revoke-sessions", "POST", reason)).status).toBe(200);
  expect((await request("/probe", "GET", undefined, "admin-a#0")).status).toBe(401);
  expect((await request("/probe", "GET", undefined, "admin-a#1")).status).toBe(200);
  expect((await request("/auth/refresh", "POST", {}, null, "refreshToken=refresh-a")).status).toBe(401);
});
test.each(["security", "revoke-sessions"])("platform identities are excluded from tenant account actions: %s", async (action) => {
  expect((await request("/system-admin/users/platform/" + action, "POST", { ...reason, ...(action === "security" ? { securityStatus: "BLOCKED" } : {}) })).status).toBe(404);
});
test.each([{ status: "SUSPENDED" }, { status: "SUSPENDED", reason: "", confirm: true }, { ...reason, status: "SUSPENDED", organizationId: "org-b" }])("sensitive mutations require explicit validated confirmation and reason", async (body) => {
  expect((await request("/system-admin/tenants/org-a/status", "POST", body)).status).toBe(400);
  expect(db.organization.update).not.toHaveBeenCalled();
});
test.each(["tenant", "user", "sessions"])("audit failure rolls back %s mutation and all token changes", async (kind) => {
  const saved = structuredClone({ users, organizations, tokens }); failAudit = true;
  const path = kind === "tenant" ? "/system-admin/tenants/org-a/status" : "/system-admin/users/admin-a/" + (kind === "user" ? "security" : "revoke-sessions");
  const body = kind === "tenant" ? { ...reason, status: "ARCHIVED" } : kind === "user" ? { ...reason, securityStatus: "BLOCKED" } : reason;
  expect((await request(path, "POST", body)).status).toBe(500);
  expect({ users, organizations, tokens }).toEqual(saved);
});
test("lists are paginated, exclude platform accounts and secrets, and audit list enforces platform scope", async () => {
  const result = await request("/system-admin/users?pageSize=1");
  expect(result.body.data.items).toHaveLength(1); expect(result.body.data.pagination.total).toBe(2);
  for (const secret of ["password", "inviteToken", "userPermissions"]) expect(result.body.data.items[0]).not.toHaveProperty(secret);
  expect((await request("/system-admin/users/platform")).status).toBe(404);
  expect((await request("/system-admin/audit-logs")).body.data.items).toEqual([]);
  expect((await request("/system-admin/users?pageSize=101")).status).toBe(400);
});
