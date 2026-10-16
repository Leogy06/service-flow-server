import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";

const databaseName = process.env.DATABASE_NAME ?? "";
if (process.env.NODE_ENV !== "test" || process.env.RUN_DB_PLATFORM_TESTS !== "1" ||
    !/^service_flow_platform_test_[a-z0-9_]+$/.test(databaseName) || process.env.PLATFORM_TEST_DATABASE_NAME !== databaseName ||
    new URL(process.env.DATABASE_URL).pathname !== `/${databaseName}`) throw new Error("Isolated platform test database required");

const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { requestContext } = await import("../../src/lib/requestContext.ts");
const { signupService } = await import("../../src/modules/system-admin/signup.service.ts");
const { authService } = await import("../../src/modules/auth/auth.service.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const { default: platformRoutes } = await import("../../src/modules/system-admin/system-admin.routes.ts");
const { default: authRoutes } = await import("../../src/modules/auth/auth.routes.ts");
const { authenticate } = await import("../../src/middleware/auth.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { TENANT_ADMIN_PERMISSIONS } = await import("../../src/constants/default-roles.ts");
const { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } = await import("../../src/constants/legal.ts");

test("public signup waits for approval and provisions one isolated workspace under real MySQL locks", { timeout: 90000 }, async () => {
  let server;
  const tag = randomUUID().slice(0, 12);
  const password = "SignupPassword123";
  const applicant = (suffix) => ({ firstName: "New", lastName: "Owner", email: `signup-${tag}-${suffix}@example.invalid`, password,
    organizationName: `Signup ${tag} ${suffix}`, slug: `signup-${tag}-${suffix}`,
    termsAccepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyAcknowledged: true, privacyVersion: CURRENT_PRIVACY_VERSION });
  try {
    // Match the existing seeded global permission definitions without changing their ownership.
    for (const name of TENANT_ADMIN_PERMISSIONS) await prisma.permission.upsert({ where: { name }, update: {}, create: { name } });
    const role = await prisma.role.create({ data: { name: `Signup operator ${tag}` } });
    const actor = await prisma.user.create({ data: { firstName: "Signup", lastName: "Operator", email: `signup-operator-${tag}@example.invalid`, roleId: role.id, status: "ACTIVE", platformRole: "SYSTEM_ADMIN" } });
    const otherOrg = await prisma.organization.create({ data: { name: "Existing private tenant", slug: `existing-${tag}` } });
    const otherRole = await prisma.role.create({ data: { name: "Admin", organizationId: otherOrg.id } });
    const tenant = await prisma.user.create({ data: { email: `signup-tenant-${tag}@example.invalid`, firstName: "Other", lastName: "Admin", roleId: otherRole.id, organizationId: otherOrg.id, status: "ACTIVE" } });
    const operatorToken = generateAccessToken({ ...actor, role: role.name, permissions: [] });
    const tenantToken = generateAccessToken({ ...tenant, role: otherRole.name, permissions: [] });
    const plan = await prisma.plan.create({ data: { name: `Signup plan ${tag}`, price: "999.00", currency: "PHP", billingInterval: "MONTHLY", maxActiveUsers: 3 } });
    const app = express(); app.use(express.json(), withRequestContext);
    app.use("/auth", authRoutes); app.use("/admin", platformRoutes);
    app.get("/probe", authenticate, (req, res) => res.json(req.user));
    app.use((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : "Internal server error" }));
    server = createServer(app); await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const http = async (path, method = "GET", body, token) => {
      const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie") };
    };
    const asOperator = (work) => requestContext.run({ requestId: `signup-${tag}`, userId: actor.id }, work);
    const details = applicant("a");
    const submitted = await http("/auth/register", "POST", details);
    assert.equal(submitted.status, 202); assert.deepEqual(submitted.body.data, { submitted: true }); assert.equal(submitted.cookie, null);
    const application = await prisma.signupRequest.findUniqueOrThrow({ where: { email: details.email } });
    assert.equal(application.status, "PENDING"); assert.ok(application.passwordHash); assert.notEqual(application.passwordHash, password);
    assert.ok(application.termsAcceptedAt instanceof Date); assert.equal(application.termsVersion, CURRENT_TERMS_VERSION);
    assert.equal(application.privacyVersion, CURRENT_PRIVACY_VERSION);
    assert.equal(await prisma.user.count({ where: { email: details.email } }), 0);
    assert.equal((await http("/auth/login", "POST", { email: details.email, password })).status, 401);
    await signupService.submit({ ...details, firstName: "Overwrite", password: "ChangedPassword123" });
    assert.equal((await prisma.signupRequest.findUniqueOrThrow({ where: { id: application.id } })).passwordHash, application.passwordHash);
    assert.equal((await http("/admin/signup-requests")).status, 401);
    assert.equal((await http("/admin/signup-requests/count", "GET", undefined, tenantToken)).status, 403);
    const body = { decision: "APPROVED", slug: details.slug, planId: plan.id, startTrial: true, reason: "Isolated reviewed business signup", confirm: true };
    assert.equal((await http(`/admin/signup-requests/${application.id}/review`, "POST", body, tenantToken)).status, 403);
    const list = await http("/admin/signup-requests?status=PENDING&search=" + tag, "GET", undefined, operatorToken);
    assert.equal(list.status, 200); assert.equal(list.body.data.items[0].passwordHash, undefined);
    assert.equal(list.body.data.items[0].termsAcceptedAt, application.termsAcceptedAt.toISOString());
    assert.equal(list.body.data.items[0].termsVersion, CURRENT_TERMS_VERSION); assert.equal(list.body.data.items[0].privacyVersion, CURRENT_PRIVACY_VERSION);
    const approvals = await asOperator(() => Promise.all([signupService.review(application.id, body), signupService.review(application.id, body)]));
    assert.equal(approvals[0].organization.id, approvals[1].organization.id);
    const reviewed = await prisma.signupRequest.findUniqueOrThrow({ where: { id: application.id }, include: { organization: { include: { subscription: true } } } });
    assert.equal(reviewed.status, "APPROVED"); assert.equal(reviewed.passwordHash, null); assert.equal(reviewed.reviewedBy, actor.id);
    assert.equal(reviewed.termsAcceptedAt.toISOString(), application.termsAcceptedAt.toISOString());
    assert.equal(reviewed.termsVersion, CURRENT_TERMS_VERSION); assert.equal(reviewed.privacyVersion, CURRENT_PRIVACY_VERSION);
    assert.notEqual(reviewed.organizationId, otherOrg.id); assert.equal(reviewed.organization.billingEnabled, true);
    assert.equal(reviewed.organization.subscription.status, "TRIALING");
    assert.equal(await prisma.user.count({ where: { organizationId: reviewed.organizationId } }), 1);
    assert.equal(await prisma.role.count({ where: { organizationId: reviewed.organizationId } }), 3);
    assert.equal(await prisma.auditLog.count({ where: { entityId: application.id, action: "signup.reviewed" } }), 1);
    const login = await http("/auth/login", "POST", { email: details.email, password });
    assert.equal(login.status, 200); assert.equal(login.body.data.user.role, "Admin"); assert.equal(login.body.data.user.platformRole, "NONE");
    assert.deepEqual(new Set(login.body.data.permissions), new Set(TENANT_ADMIN_PERMISSIONS));
    const probe = await http("/probe", "GET", undefined, login.body.data.accessToken);
    assert.equal(probe.status, 200); assert.equal(probe.body.organizationId, reviewed.organizationId);
    assert.equal((await http("/admin/signup-requests", "GET", undefined, login.body.data.accessToken)).status, 403);

    const deniedDetails = applicant("rejected"); await signupService.submit(deniedDetails);
    const denied = await prisma.signupRequest.findUniqueOrThrow({ where: { email: deniedDetails.email } });
    await asOperator(() => signupService.review(denied.id, { decision: "REJECTED", reason: "Isolated rejection check", confirm: true }));
    assert.equal((await prisma.signupRequest.findUniqueOrThrow({ where: { id: denied.id } })).passwordHash, null);
    assert.equal(await prisma.user.count({ where: { email: deniedDetails.email } }), 0);

    const legacyDetails = applicant("legacy"); await signupService.submit(legacyDetails);
    const legacy = await prisma.signupRequest.update({ where: { email: legacyDetails.email },
      data: { termsAcceptedAt: null, termsVersion: null, privacyVersion: null } });
    await assert.rejects(asOperator(() => signupService.review(legacy.id, { ...body, slug: legacyDetails.slug })),
      (error) => error.statusCode === 409 && error.code === "SIGNUP_AGREEMENT_REQUIRED");
    assert.deepEqual(await signupService.submit({ ...legacyDetails, password: "WrongPassword123" }), { submitted: true });
    assert.equal((await prisma.signupRequest.findUniqueOrThrow({ where: { id: legacy.id } })).termsAcceptedAt, null);
    const completed = await Promise.all([signupService.submit(legacyDetails), signupService.submit({ ...legacyDetails, firstName: "Attempted overwrite" })]);
    assert.deepEqual(completed, [{ submitted: true }, { submitted: true }]);
    const completedLegacy = await prisma.signupRequest.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.ok(completedLegacy.termsAcceptedAt); assert.equal(completedLegacy.firstName, legacy.firstName);
    assert.equal(completedLegacy.passwordHash, legacy.passwordHash);
    assert.equal(await prisma.auditLog.count({ where: { entityId: legacy.id, action: "signup.agreement.recorded" } }), 1);
    await asOperator(() => signupService.review(legacy.id, { ...body, slug: legacyDetails.slug }));

    const unpaid = applicant("unpaid"); await signupService.submit(unpaid);
    const unpaidRequest = await prisma.signupRequest.findUniqueOrThrow({ where: { email: unpaid.email } });
    await asOperator(() => signupService.review(unpaidRequest.id, { ...body, slug: unpaid.slug, startTrial: false }));
    await assert.rejects(authService.login(unpaid.email, password), (error) => error.statusCode === 403);

    const raceDetails = [applicant("race-a"), applicant("race-b")];
    await Promise.all(raceDetails.map((item) => signupService.submit(item)));
    const races = await prisma.signupRequest.findMany({ where: { email: { in: raceDetails.map((item) => item.email) } } });
    const competing = await asOperator(() => Promise.allSettled(races.map((item) => signupService.review(item.id, { ...body, slug: `signup-${tag}-shared` }))));
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(competing.find((result) => result.status === "rejected").reason.statusCode, 409);
    assert.equal(await prisma.organization.count({ where: { slug: `signup-${tag}-shared` } }), 1);
    const events = await prisma.auditLog.findMany({ where: { entityId: application.id } });
    assert.equal(JSON.stringify(events).includes(application.passwordHash), false); assert.equal(JSON.stringify(events).includes(password), false);
    console.log("Real signup MySQL checks passed: 202/no session, versioned agreement persistence, waiting/no login, duplicate credentials, tenant guards, concurrent approval and slug uniqueness, password-verified legacy agreement recovery, default permissions, trial login, rejection, payment gating and safe audits.");
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
    await prisma.$disconnect(); await redis.quit();
  }
});
