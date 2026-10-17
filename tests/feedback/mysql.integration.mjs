import "dotenv/config";
import process from "node:process";
import { URL } from "node:url";
import console from "node:console";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import express from "express";
import request from "supertest";

const databaseName = process.env.DATABASE_NAME ?? "";
if (process.env.RUN_DB_PLATFORM_TESTS !== "1" || process.env.NODE_ENV !== "test" ||
    !/^service_flow_platform_test_[a-z0-9_]+$/.test(databaseName) || process.env.PLATFORM_TEST_DATABASE_NAME !== databaseName ||
    decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) !== databaseName) {
  throw new Error("Use the isolated feedback MySQL runner with matching test database settings");
}
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { feedbackService } = await import("../../src/modules/feedback/feedback.service.ts");
const { requestContext } = await import("../../src/lib/requestContext.ts");
const { tenantFeedbackRoutes, platformFeedbackRoutes, publicFeedbackRoutes } = await import("../../src/modules/feedback/feedback.routes.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { errorHandler } = await import("../../src/middleware/errorHandler.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const { apiLimiter } = await import("../../src/middleware/rateLimiter.ts");

test("real MySQL feedback ownership, replay, constraints, withdrawal races and HTTP authorization", { timeout: 90000 }, async () => {
  const tag = randomUUID();
  const orgA = `fb-a-${tag}`, orgB = `fb-b-${tag}`;
  const userA = `fb-user-a-${tag}`, userB = `fb-user-b-${tag}`, operator = `fb-operator-${tag}`;
  const roleA = `fb-role-a-${tag}`, roleB = `fb-role-b-${tag}`, rolePlatform = `fb-role-p-${tag}`;
  const requestA = `fb-request-${tag}`, customerA = `fb-customer-${tag}`, typeA = `fb-type-${tag}`;
  const tenant = (work, id = orgA, userId = userA) => requestContext.run({ requestId: `fb-${tag}`, organizationId: id, userId }, work);
  const platform = (work) => requestContext.run({ requestId: `fb-${tag}`, userId: operator }, work);
  const query = { page: 1, pageSize: 10 };
  try {
    await prisma.organization.createMany({ data: [orgA, orgB].map((id) => ({ id, slug: id, name: id })) });
    await prisma.role.createMany({ data: [
      { id: roleA, name: "Admin", organizationId: orgA }, { id: roleB, name: "Admin", organizationId: orgB },
      { id: rolePlatform, name: "Feedback platform fixture" },
    ] });
    const permissions = await prisma.permission.findMany({ where: { name: { in: ["feedback:create", "feedback:read", "feedback:update"] }, organizationId: null } });
    assert.equal(permissions.length, 3, "Migration must provision all feedback definitions");
    await prisma.rolePermission.createMany({ data: [roleA, roleB].flatMap((roleId) => permissions.map((p) => ({ roleId, permissionId: p.id }))) });
    await prisma.user.createMany({ data: [
      { id: userA, organizationId: orgA, roleId: roleA }, { id: userB, organizationId: orgB, roleId: roleB },
      { id: operator, roleId: rolePlatform, platformRole: "SYSTEM_ADMIN" },
    ].map((row) => ({ ...row, email: `${row.id}@example.invalid`, firstName: "Feedback", lastName: "Fixture", status: "ACTIVE" })) });
    await prisma.customer.create({ data: { id: customerA, organizationId: orgA, name: customerA, email: `${customerA}@example.invalid`, phoneNumber: customerA } });
    await prisma.serviceType.create({ data: { id: typeA, organizationId: orgA, name: "Feedback fixture", basePrice: "1" } });
    await prisma.serviceRequest.create({ data: { id: requestA, referenceNumber: requestA, organizationId: orgA, customerId: customerA, serviceTypeId: typeA, title: "Private request title", status: "COMPLETED" } });
    await prisma.job.create({ data: { referenceNumber: `fb-job-${tag}`, organizationId: orgA, customerId: customerA, serviceTypeId: typeA, serviceRequestId: requestA, status: "COMPLETED", internalNotes: "Never expose internal details" } });

    const productInput = { submissionKey: randomUUID(), rating: 5, comment: "Service Flow simplified our work", displayName: "Business owner", allowTestimonial: true };
    const simultaneous = await Promise.allSettled([1, 2].map(() => tenant(() => feedbackService.submitProduct(productInput))));
    assert.ok(simultaneous.some((result) => result.status === "fulfilled"));
    const product = await tenant(() => feedbackService.submitProduct(productInput));
    assert.deepEqual((await tenant(() => feedbackService.mine({ ...query, status: "RESOLVED" }))).stats,
      { total: 1, averageRating: 5, byStatus: { NEW: 1, IN_REVIEW: 0, RESOLVED: 0 }, approvedTestimonials: 0 });
    assert.equal(await prisma.productFeedback.count({ where: { organizationId: orgA } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entityId: product.id, action: "feedback.product.submitted" } }), 1);
    assert.equal((await tenant(() => feedbackService.mine(query), orgB, userB)).feedback.length, 0);
    await assert.rejects(() => tenant(() => feedbackService.withdrawProduct(product.id), orgB, userB), { statusCode: 404 });
    await platform(() => feedbackService.reviewProduct(product.id, { testimonialApproved: true }));
    assert.equal((await tenant(() => feedbackService.mine(query))).stats.approvedTestimonials, 1);
    await Promise.allSettled([
      platform(() => feedbackService.reviewProduct(product.id, { testimonialApproved: true })),
      tenant(() => feedbackService.withdrawProduct(product.id)),
    ]);
    await tenant(() => feedbackService.withdrawProduct(product.id));
    let saved = await prisma.productFeedback.findUniqueOrThrow({ where: { id: product.id } });
    assert.ok(saved.consentWithdrawnAt); assert.equal(saved.testimonialApprovedAt, null);
    assert.equal((await tenant(() => feedbackService.mine(query))).stats.approvedTestimonials, 0);
    await assert.rejects(() => platform(() => feedbackService.reviewProduct(product.id, { testimonialApproved: true })), { statusCode: 409 });

    await assert.rejects(() => tenant(() => feedbackService.createInvitation(requestA), orgB, userB), { statusCode: 404 });
    const first = await tenant(() => feedbackService.createInvitation(requestA));
    const second = await tenant(() => feedbackService.createInvitation(requestA));
    await assert.rejects(() => feedbackService.publicContext(first.token), { statusCode: 404 });
    const invitation = await prisma.feedbackInvitation.findUniqueOrThrow({ where: { serviceRequestId: requestA } });
    assert.equal(invitation.tokenHash, createHash("sha256").update(second.token).digest("hex"));
    await assert.rejects(() => prisma.customerFeedback.create({ data: { organizationId: orgB, invitationId: invitation.id, rating: 5, comment: "Foreign tenant" } }));
    const input = { token: second.token, rating: 4, comment: "Great repair service", displayName: "Customer", allowTestimonial: true };
    const submissions = await Promise.allSettled([1, 2].map(() => feedbackService.submitCustomer(input)));
    assert.ok(submissions.some((result) => result.status === "fulfilled"));
    await feedbackService.submitCustomer(input);
    assert.equal(await prisma.customerFeedback.count({ where: { invitationId: invitation.id } }), 1);
    const customerFeedback = (await tenant(() => feedbackService.listCustomer(query))).feedback[0];
    assert.equal((await tenant(() => feedbackService.listCustomer(query), orgB, userB)).feedback.length, 0);
    await assert.rejects(() => tenant(() => feedbackService.reviewCustomer(customerFeedback.id, { status: "RESOLVED" }), orgB, userB), { statusCode: 404 });
    await tenant(() => feedbackService.reviewCustomer(customerFeedback.id, { testimonialApproved: true, status: "IN_REVIEW" }));
    assert.deepEqual((await tenant(() => feedbackService.listCustomer({ ...query, status: "RESOLVED", testimonials: "ready" }))).stats,
      { total: 1, averageRating: 4, byStatus: { NEW: 0, IN_REVIEW: 1, RESOLVED: 0 }, approvedTestimonials: 1 });
    await prisma.feedbackInvitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(0) } });
    await feedbackService.withdrawCustomer(second.token);
    assert.deepEqual(await feedbackService.publicContext(second.token), { businessName: orgA, submitted: true, consentActive: false });
    saved = await prisma.customerFeedback.findUniqueOrThrow({ where: { id: customerFeedback.id } });
    assert.equal(saved.testimonialApprovedAt, null); assert.ok(saved.consentWithdrawnAt);
    assert.equal((await tenant(() => feedbackService.listCustomer(query))).stats.approvedTestimonials, 0);
    await assert.rejects(() => tenant(() => feedbackService.createInvitation(requestA)), { statusCode: 409 });

    const app = express(); app.use(express.json(), withRequestContext, apiLimiter);
    app.use("/tenant", tenantFeedbackRoutes); app.use("/platform", platformFeedbackRoutes); app.use("/public", publicFeedbackRoutes); app.use(errorHandler);
    const auth = (id, organizationId) => generateAccessToken({ id, organizationId, email: `${id}@example.invalid`, firstName: "Feedback", lastName: "Fixture", role: "Admin" });
    const authA = auth(userA, orgA), authB = auth(userB, orgB);
    assert.equal((await request(app).get("/tenant/customers")).status, 401);
    assert.equal((await request(app).get("/platform").auth(authA, { type: "bearer" })).status, 403);
    assert.equal((await request(app).get("/platform").auth(auth(operator, null), { type: "bearer" })).status, 200);
    const inboxB = await request(app).get("/tenant/customers?organizationId=" + orgA).auth(authB, { type: "bearer" });
    assert.equal(inboxB.status, 200); assert.deepEqual(inboxB.body.data.feedback, []);
    assert.deepEqual(inboxB.body.data.stats, { total: 0, averageRating: null, byStatus: { NEW: 0, IN_REVIEW: 0, RESOLVED: 0 }, approvedTestimonials: 0 });
    assert.equal((await request(app).patch(`/tenant/customers/${customerFeedback.id}`).auth(authB, { type: "bearer" }).send({ status: "RESOLVED" })).status, 404);
    const context = await request(app).post("/public/context").send({ token: second.token });
    assert.equal(context.status, 200); assert.deepEqual(Object.keys(context.body.data).sort(), ["businessName", "consentActive", "submitted"]);
    assert.ok(!JSON.stringify(context.body).includes("Private request title"));
    await prisma.userPermission.create({ data: { userId: userA, permissionId: permissions.find((p) => p.name === "feedback:read").id, isActive: false } });
    assert.equal((await request(app).get("/tenant/customers").auth(authA, { type: "bearer" })).status, 403);
    console.log("Feedback integration fixtures retained in isolated database; no existing application records modified.");
  } finally { await prisma.$disconnect(); await redis.quit(); }
});
