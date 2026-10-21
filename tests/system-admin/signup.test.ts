import { jest } from "@jest/globals";
import express from "express";
import { MemoryStore } from "express-rate-limit";
import request from "supertest";
import bcrypt from "bcryptjs";
import { rateLimitEnvironmentSchema } from "../../src/config/rate-limit.js";
import type { Prisma, SignupRequest } from "../../src/generated/prisma/client.js";
import { TENANT_ADMIN_PERMISSIONS } from "../../src/constants/default-roles.js";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "../../src/constants/legal.js";

let applications: SignupRequest[] = [];
let createdUsers: Prisma.UserUncheckedCreateInput[] = [];
let organizations: { id: string; name: string; slug: string }[] = [];
let subscriptions: Prisma.SubscriptionUncheckedCreateInput[] = [];
let audits: Prisma.AuditLogUncheckedCreateInput[] = [];
let roles: Prisma.RoleCreateInput[] = [];
let failAudit = false;
let permissionCount = TENANT_ADMIN_PERMISSIONS.length;
let activePlan = true;
const password = "SignupPassword123";
const input = { firstName: "New", lastName: "Owner", email: "new@example.invalid", password, organizationName: "New Business", slug: "new-business",
  termsAccepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyAcknowledged: true, privacyVersion: CURRENT_PRIVACY_VERSION } as const;
const approval = { decision: "APPROVED", planId: "plan", slug: "new-business", startTrial: true, reason: "Reviewed business application", confirm: true };
const reject = { decision: "REJECTED", reason: "Application was not accepted", confirm: true };
function publicApplication(row: SignupRequest) {
  const { passwordHash: _passwordHash, organizationId, updatedAt: _updatedAt, ...data } = row;
  return { ...data, organization: organizations.find((org) => org.id === organizationId) ?? null };
}
const db = {
  signupRequest: {
    findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) => applications.find((row) => where.id ? row.id === where.id : row.email === where.email) ?? null),
    create: jest.fn(async ({ data }: { data: Prisma.SignupRequestCreateInput }) => {
      const row: SignupRequest = { id: "request-" + applications.length, status: "PENDING", reviewedBy: null,
        reviewReason: null, organizationId: null, middleName: null, suffix: null, phone: null, passwordHash: null,
        termsVersion: null, privacyVersion: null, ...data,
        termsAcceptedAt: typeof data.termsAcceptedAt === "string" ? new Date(data.termsAcceptedAt) : data.termsAcceptedAt ?? null,
        createdAt: new Date(), updatedAt: new Date(), reviewedAt: null };
      applications.push(row); return { id: row.id };
    }),
    count: jest.fn(async ({ where }: { where: { status?: string } }) => applications.filter((row) => !where.status || row.status === where.status).length),
    findMany: jest.fn(async ({ where, skip, take }: { where: { status?: string }; skip: number; take: number }) => applications.filter((row) => !where.status || row.status === where.status).slice(skip, skip + take).map(publicApplication)),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<SignupRequest> }) => {
      const row = applications.find((row) => row.id === where.id)!; Object.assign(row, data); return publicApplication(row);
    }),
  },
  user: {
    findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string; phone?: string } }) => {
      if (where.id) return {
        id: where.id, organizationId: where.id === "tenant" ? "other-org" : null, status: "ACTIVE", deletedAt: null,
        securityStatus: "ACTIVE", platformRole: where.id === "tenant" ? "NONE" : "SYSTEM_ADMIN", sessionVersion: 0,
        firstName: "Operator", lastName: "Test", email: "operator@example.invalid",
        organization: { id: "other-org", slug: "other", status: "ACTIVE", billingEnabled: false },
        role: { name: "Admin", organizationId: "other-org", deletedAt: null, permissions: [] }, userPermissions: [],
      };
      return createdUsers.find((user) => where.email ? user.email === where.email : user.phone === where.phone) ?? null;
    }),
    create: jest.fn(async ({ data }: { data: Prisma.UserUncheckedCreateInput }) => { createdUsers.push(data); return { id: "new-user" }; }),
  },
  organization: {
    findUnique: jest.fn(async ({ where }: { where: { slug: string } }) => organizations.find((row) => row.slug === where.slug) ?? null),
    create: jest.fn(async ({ data }: { data: { name: string; slug: string } }) => { const row = { id: "new-org", ...data }; organizations.push(row); return row; }),
  },
  permission: { findMany: jest.fn(async () => TENANT_ADMIN_PERMISSIONS.slice(0, permissionCount).map((name, index) => ({ id: "permission-" + index, name }))) },
  role: { create: jest.fn(async ({ data }: { data: Prisma.RoleCreateInput }) => { roles.push(data); return { id: "role-" + data.name }; }) },
  plan: { findUnique: jest.fn(async () => ({ id: "plan", isActive: activePlan, maxActiveUsers: 3, price: "999.00", currency: "PHP", billingInterval: "MONTHLY" })) },
  subscription: { create: jest.fn(async ({ data }: { data: Prisma.SubscriptionUncheckedCreateInput }) => { subscriptions.push(data); return { id: "subscription", ...data }; }) },
  subscriptionHistory: { create: jest.fn(async () => ({})) },
  auditLog: { create: jest.fn(async ({ data }: { data: Prisma.AuditLogUncheckedCreateInput }) => { if (failAudit) throw new Error("Audit unavailable"); audits.push(data); return {}; }) },
  $queryRaw: jest.fn(async (_sql: TemplateStringsArray, id: string) => applications.filter((row) => row.id === id).map((row) => ({ id: row.id }))),
  $transaction: jest.fn(async (work: (transaction: unknown) => Promise<unknown>) => {
    const saved = structuredClone({ applications, createdUsers, organizations, subscriptions, audits, roles });
    try { return await work(db); } catch (error) { ({ applications, createdUsers, organizations, subscriptions, audits, roles } = saved); throw error; }
  }),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: {}, redisReady: async () => {} }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn() }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { ...rateLimitEnvironmentSchema.parse({}), APP_ENV: "test", SALT_ROUNDS: 4, SIGNUP_RATE_LIMIT_WINDOW_MS: 60000, SIGNUP_RATE_LIMIT_MAX: 2, REFUND_RATE_LIMIT_WINDOW_MS: 60000, REFUND_RATE_LIMIT_MAX: 10 } }));
jest.unstable_mockModule("rate-limit-redis", () => {
  return { RedisStore: class extends MemoryStore { constructor() { super(); } } };
});
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (token: string) => ({ sub: token }) }));
const { signupService } = await import("@/modules/system-admin/signup.service.js");
const { default: routes } = await import("@/modules/system-admin/signup.routes.js");
const { registerSchema } = await import("@/modules/auth/auth.schema.js");
const { signupLimiter } = await import("@/middleware/rateLimiter.js");
const { validate } = await import("@/middleware/validate.js");
const { authenticate } = await import("@/middleware/auth.js");
const { requireSystemAdmin } = await import("@/middleware/require-platform-admin.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { requestContext } = await import("@/lib/requestContext.js");
const operator = <T>(work: () => Promise<T>) => requestContext.run({ requestId: "signup-test", userId: "operator" }, work);
const app = express();
app.use(express.json(), withRequestContext);
app.post("/register", signupLimiter, validate(registerSchema), async (req, res, next) => {
  try { res.status(202).json(await signupService.submit(req.validated.body as typeof input)); } catch (error) { next(error); }
});
app.use("/admin", authenticate, requireSystemAdmin, routes);
app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);
beforeEach(() => {
  applications = []; createdUsers = []; organizations = []; subscriptions = []; audits = []; roles = [];
  failAudit = false; permissionCount = TENANT_ADMIN_PERMISSIONS.length; activePlan = true; jest.clearAllMocks();
});
async function submit() { await signupService.submit(input); return applications[0].id; }
function removeAgreement() {
  applications[0].termsAcceptedAt = null; applications[0].termsVersion = null; applications[0].privacyVersion = null;
}

test("public signup stores a hash and audit without creating accounts, tenants or sessions", async () => {
  const startedAt = Date.now();
  expect(await signupService.submit(input)).toEqual({ submitted: true });
  expect(await bcrypt.compare(password, applications[0].passwordHash!)).toBe(true);
  expect(createdUsers).toEqual([]); expect(organizations).toEqual([]); expect(subscriptions).toEqual([]);
  expect(audits[0]).toMatchObject({ action: "signup.requested", actorId: null });
  expect(applications[0]).toMatchObject({ termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION });
  expect(applications[0].termsAcceptedAt).toBeInstanceOf(Date);
  expect(+applications[0].termsAcceptedAt!).toBeGreaterThanOrEqual(startedAt);
  expect(+applications[0].termsAcceptedAt!).toBeLessThanOrEqual(Date.now());
  expect(audits[0].metadata).toMatchObject({ after: { termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION,
    termsAcceptedAt: applications[0].termsAcceptedAt!.toISOString(), privacyAcknowledged: true } });
  expect(JSON.stringify(audits)).not.toContain(password);
  expect(JSON.stringify(audits)).not.toContain(applications[0].passwordHash);
});
test("duplicate signup cannot overwrite applicant credentials or disclose existing accounts", async () => {
  await submit(); const hash = applications[0].passwordHash; const acceptedAt = applications[0].termsAcceptedAt;
  expect(await signupService.submit({ ...input, password: "ChangedPassword123", firstName: "Overwrite" })).toEqual({ submitted: true });
  expect(applications).toHaveLength(1); expect(applications[0].passwordHash).toBe(hash); expect(applications[0].firstName).toBe("New");
  expect(applications[0].termsAcceptedAt).toEqual(acceptedAt);
  expect(audits).toHaveLength(1);
  createdUsers.push({ ...input, roleId: "existing" }); applications = [];
  expect(await signupService.submit(input)).toEqual({ submitted: true }); expect(applications).toEqual([]);
});

test.each([
  { ...input, termsAccepted: false }, { ...input, termsAccepted: undefined }, { ...input, termsAccepted: "true" },
  { ...input, termsVersion: "2026-10-16" }, { ...input, termsVersion: undefined },
  { ...input, privacyAcknowledged: false }, { ...input, privacyAcknowledged: undefined },
  { ...input, privacyVersion: "2026-10-16" }, { ...input, privacyVersion: undefined },
  { ...input, termsAcceptedAt: "2020-01-01T00:00:00.000Z" },
])("registration and direct service calls require explicit current acceptance before database work %#", async (body) => {
  expect(registerSchema.safeParse({ body }).success).toBe(false);
  await expect(signupService.submit(body as unknown as Parameters<typeof signupService.submit>[0])).rejects.toMatchObject({ statusCode: 400 });
  expect(db.$transaction).not.toHaveBeenCalled(); expect(db.signupRequest.create).not.toHaveBeenCalled();
  expect(applications).toEqual([]); expect(audits).toEqual([]);
});

test("submission rolls back acceptance and the application when the audit fails", async () => {
  failAudit = true;
  await expect(signupService.submit(input)).rejects.toThrow("Audit unavailable");
  expect(applications).toEqual([]); expect(audits).toEqual([]);
  expect(createdUsers).toEqual([]); expect(organizations).toEqual([]);
});

test("the original legacy applicant can record agreement without replacing submitted details", async () => {
  await submit(); removeAgreement();
  const before = structuredClone(applications[0]);
  expect(await signupService.submit({ ...input, firstName: "Replacement", organizationName: "Replacement Business", slug: "replacement-business" })).toEqual({ submitted: true });
  expect(applications).toHaveLength(1);
  expect(applications[0]).toMatchObject({ ...before, termsAcceptedAt: expect.any(Date),
    termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION });
  expect(audits.at(-1)).toMatchObject({ action: "signup.agreement.recorded", actorType: "SYSTEM", actorId: null });
  expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  expect(createdUsers).toEqual([]); expect(organizations).toEqual([]);
});

test("a wrong password cannot record agreement for a legacy applicant", async () => {
  await submit(); removeAgreement(); const before = structuredClone({ applications, audits });
  expect(await signupService.submit({ ...input, password: "WrongPassword123" })).toEqual({ submitted: true });
  expect({ applications, audits }).toEqual(before);
  expect(db.signupRequest.update).not.toHaveBeenCalled();
});

test.each(["existing account", "reviewed request", "partial evidence"])("legacy agreement does not change %s", async (kind) => {
  await submit(); removeAgreement();
  if (kind === "existing account") createdUsers.push({ email: input.email, firstName: "Existing", lastName: "User", roleId: "existing" });
  if (kind === "reviewed request") applications[0].status = "REJECTED";
  if (kind === "partial evidence") applications[0].termsVersion = CURRENT_TERMS_VERSION;
  const before = structuredClone({ applications, audits });
  expect(await signupService.submit(input)).toEqual({ submitted: true });
  expect({ applications, audits }).toEqual(before); expect(db.signupRequest.update).not.toHaveBeenCalled();
});

test("legacy agreement rechecks the locked request after a concurrent review", async () => {
  await submit(); removeAgreement();
  db.$queryRaw.mockImplementationOnce(async (_sql, id) => {
    applications[0].status = "REJECTED"; applications[0].passwordHash = null;
    return [{ id }];
  });
  expect(await signupService.submit(input)).toEqual({ submitted: true });
  expect(applications[0]).toMatchObject({ status: "REJECTED", passwordHash: null, termsAcceptedAt: null });
  expect(db.signupRequest.update).not.toHaveBeenCalled(); expect(audits).toHaveLength(1);
});

test("legacy agreement and its audit roll back together", async () => {
  await submit(); removeAgreement(); const before = structuredClone({ applications, audits }); failAudit = true;
  await expect(signupService.submit(input)).rejects.toThrow("Audit unavailable");
  expect({ applications, audits }).toEqual(before);
});
test("approval provisions an isolated tenant, default roles and trial atomically and clears pending credentials", async () => {
  const id = await submit(); const hash = applications[0].passwordHash; const termsAcceptedAt = applications[0].termsAcceptedAt;
  const reviewed = await operator(() => signupService.review(id, approval as Parameters<typeof signupService.review>[1]));
  expect(reviewed).toMatchObject({ termsAcceptedAt, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION });
  expect(createdUsers[0]).toMatchObject({ organizationId: "new-org", roleId: "role-Admin", platformRole: "NONE", status: "ACTIVE", password: hash });
  expect(roles.map((role) => role.name)).toEqual(["Admin", "Manager", "Staff"]);
  expect(subscriptions[0]).toMatchObject({ organizationId: "new-org", status: "TRIALING", planId: "plan" });
  expect(+new Date(subscriptions[0].trialExpiresAt!) - +new Date(subscriptions[0].trialStartedAt!)).toBe(14 * 86400000);
  expect(applications[0]).toMatchObject({ status: "APPROVED", passwordHash: null, reviewedBy: "operator", organizationId: "new-org" });
  expect(audits.at(-1)).toMatchObject({ action: "signup.reviewed", actorId: "operator", organizationId: "new-org" });
  expect(JSON.stringify(audits)).not.toContain(hash);
  expect(await operator(() => signupService.count())).toEqual({ pending: 0 });
});

test.each([
  { termsAcceptedAt: null }, { termsVersion: null }, { privacyVersion: null },
  { termsVersion: "unpublished" }, { privacyVersion: "unpublished" },
])("approval blocks absent or unknown acceptance evidence without provisioning %#", async (evidence) => {
  const id = await submit(); Object.assign(applications[0], evidence);
  await expect(operator(() => signupService.review(id, approval as Parameters<typeof signupService.review>[1])))
    .rejects.toMatchObject({ statusCode: 409, code: "SIGNUP_AGREEMENT_REQUIRED" });
  expect(applications[0].status).toBe("PENDING");
  expect(createdUsers).toEqual([]); expect(organizations).toEqual([]); expect(subscriptions).toEqual([]);
  expect(db.signupRequest.update).not.toHaveBeenCalled();
  await operator(() => signupService.review(id, reject as Parameters<typeof signupService.review>[1]));
  expect(applications[0].status).toBe("REJECTED");
});
test("approval can retain payment-required status without starting free access", async () => {
  const id = await submit(); await operator(() => signupService.review(id, { ...approval, startTrial: false } as Parameters<typeof signupService.review>[1]));
  expect(subscriptions[0].status).toBe("PENDING"); expect(subscriptions[0].trialStartedAt).toBeUndefined();
});
test("rejection creates no account, removes the hash and preserves review history", async () => {
  const id = await submit(); await operator(() => signupService.review(id, reject as Parameters<typeof signupService.review>[1]));
  expect(applications[0]).toMatchObject({ status: "REJECTED", passwordHash: null, reviewReason: reject.reason });
  expect(createdUsers).toEqual([]); expect(organizations).toEqual([]);
  await expect(operator(() => signupService.review(id, approval as Parameters<typeof signupService.review>[1]))).rejects.toMatchObject({ statusCode: 409 });
});
test("review replay does not create duplicate users, subscriptions or audit events", async () => {
  const id = await submit(); const review = () => operator(() => signupService.review(id, approval as Parameters<typeof signupService.review>[1]));
  await review(); const before = audits.length; await review();
  expect(createdUsers).toHaveLength(1); expect(subscriptions).toHaveLength(1); expect(audits).toHaveLength(before);
});
test.each(["permissions", "plan", "slug", "email", "audit"])("approval rolls back completely when %s is unavailable", async (kind) => {
  const id = await submit();
  if (kind === "permissions") permissionCount = 0;
  if (kind === "plan") activePlan = false;
  if (kind === "slug") organizations.push({ id: "existing", name: "Other", slug: input.slug });
  if (kind === "email") createdUsers.push({ email: input.email, firstName: "Other", lastName: "User", roleId: "other" });
  if (kind === "audit") failAudit = true;
  const before = structuredClone({ applications, createdUsers, organizations, subscriptions, audits, roles });
  await expect(operator(() => signupService.review(id, approval as Parameters<typeof signupService.review>[1]))).rejects.toThrow();
  expect({ applications, createdUsers, organizations, subscriptions, audits, roles }).toEqual(before);
});
test("reads and mutations reject unauthenticated and tenant-admin callers before application lookup", async () => {
  const id = await submit();
  for (const token of [null, "tenant"]) for (const path of ["signup-requests", "signup-requests/count", `signup-requests/${id}/review`]) {
    let call = path.endsWith("/review") ? request(app).post("/admin/" + path).send(reject) : request(app).get("/admin/" + path);
    if (token) call = call.auth(token, { type: "bearer" });
    expect((await call).status).toBe(token ? 403 : 401);
  }
  expect(db.signupRequest.update).not.toHaveBeenCalled(); expect(db.signupRequest.findMany).not.toHaveBeenCalled();
});
test("operator list/count hide secrets, paginate and count only pending applications", async () => {
  await submit();
  const list = await request(app).get("/admin/signup-requests?status=PENDING&pageSize=1").auth("operator", { type: "bearer" });
  expect(list.status).toBe(200); expect(list.body.data.pagination).toMatchObject({ total: 1, pageSize: 1 });
  expect(list.body.data.items[0]).not.toHaveProperty("passwordHash");
  expect(list.body.data.items[0]).toMatchObject({ termsAcceptedAt: applications[0].termsAcceptedAt!.toISOString(),
    termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION });
  expect((await request(app).get("/admin/signup-requests/count").auth("operator", { type: "bearer" })).body.data).toEqual({ pending: 1 });
});
test.each([{ ...input, organizationId: "other-org" }, { ...input, platformRole: "SYSTEM_ADMIN" }, { ...input, roleId: "admin" }, { ...input, slug: "system-admin" }, { ...input, password: "weak" }])("registration rejects invalid or privileged input", (body) => {
  expect(registerSchema.safeParse({ body }).success).toBe(false);
});
test.each([{ ...approval, confirm: false }, { ...approval, reason: "" }, { ...approval, organizationId: "other-org" }, { ...approval, planId: "" }, { ...reject, platformRole: "SYSTEM_ADMIN" }])("review validates confirmation, reason and permitted fields", async (body) => {
  expect((await request(app).post("/admin/signup-requests/id/review").auth("operator", { type: "bearer" }).send(body)).status).toBe(400);
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
test("signup middleware returns configured 429 and Retry-After before processing more applications", async () => {
  for (let index = 0; index < 2; index++) expect((await request(app).post("/register").send(input)).status).toBe(202);
  const blocked = await request(app).post("/register").send(input);
  expect(blocked.status).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  expect(applications).toHaveLength(1);
});

test("signup review retains the shared write limit and Retry-After", async () => {
  let limited;
  for (let index = 0; index < 31; index++) {
    const result = await request(app).post("/admin/signup-requests/missing/review").auth("operator", { type: "bearer" }).send(reject);
    if (result.status === 429) { limited = result; break; }
    expect(result.status).toBe(404);
  }
  expect(limited?.status).toBe(429);
  expect(Number(limited?.headers["retry-after"])).toBeGreaterThan(0);
  expect(db.signupRequest.update).not.toHaveBeenCalled();
});
