import "dotenv/config";
import process from "node:process";
import console from "node:console";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import express from "express";
import request from "supertest";

const databaseName = process.env.DATABASE_NAME ?? "";
if (process.env.RUN_DB_PLATFORM_TESTS !== "1" || process.env.NODE_ENV !== "test" ||
    !/^service_flow_platform_test_[a-z0-9_]+$/.test(databaseName) || process.env.PLATFORM_TEST_DATABASE_NAME !== databaseName ||
    decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) !== databaseName) {
  throw new Error("Use the isolated website MySQL runner with matching test database settings");
}
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { organizationPageService: service } = await import("../../src/modules/organization/page.service.ts");
const { organizationPageRoutes } = await import("../../src/modules/organization/page.routes.ts");
const { requestContext } = await import("../../src/lib/requestContext.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { errorHandler } = await import("../../src/middleware/errorHandler.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const { apiLimiter } = await import("../../src/middleware/rateLimiter.ts");
const content = { headline: "Sample electrical services", about: "We repair and maintain household electrical systems.", services: [{ name: "Electrical repair", description: "Home repairs and maintenance." }], address: "Sample City, Philippines", serviceArea: "", hours: "", phone: "09170000000", email: "" };

test("real MySQL page isolation, publication snapshots, concurrent editors, audit rollback and HTTP authorization", { timeout: 90000 }, async () => {
  const tag = randomUUID().slice(0, 8), orgA = `page-a-${tag}`, orgB = `page-b-${tag}`;
  const adminA = `page-admin-a-${tag}`, adminB = `page-admin-b-${tag}`, staff = `page-staff-${tag}`;
  const roleA = `page-role-a-${tag}`, roleB = `page-role-b-${tag}`, roleStaff = `page-role-staff-${tag}`;
  const tenant = (work, organizationId = orgA, userId = adminA, role = "Admin") => requestContext.run({ requestId: `page-${tag}`, organizationId, userId, role }, work);
  const save = (version = null, publication = "keep", nextContent = content) => tenant(() => service.update({ content: nextContent, version, publication }));
  try {
    await prisma.organization.createMany({ data: [orgA, orgB].map((id) => ({ id, name: id, slug: id })) });
    await prisma.role.createMany({ data: [{ id: roleA, name: "Admin", organizationId: orgA }, { id: roleB, name: "Tenant Admin", organizationId: orgB }, { id: roleStaff, name: "Staff", organizationId: orgA }] });
    await prisma.user.createMany({ data: [{ id: adminA, organizationId: orgA, roleId: roleA }, { id: adminB, organizationId: orgB, roleId: roleB }, { id: staff, organizationId: orgA, roleId: roleStaff }].map((row) => ({ ...row, email: `${row.id}@example.invalid`, firstName: "Website", lastName: "Fixture", status: "ACTIVE" })) });
    assert.equal((await tenant(() => service.get())).version, null);
    assert.equal(await prisma.organizationPage.count({ where: { organizationId: orgA } }), 0);
    const initialRaces = await Promise.allSettled([save(), save()]);
    assert.equal(initialRaces.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(await prisma.organizationPage.count({ where: { organizationId: orgA } }), 1);
    const initial = await tenant(() => service.get());
    assert.equal((await tenant(() => service.get(), orgB, adminB, "Tenant Admin")).version, null);
    await assert.rejects(() => service.publicPage(orgA), { statusCode: 404 });
    const live = await save(initial.version, "publish");
    await save(live.version, "keep", { ...content, headline: "PRIVATE DRAFT" });
    assert.equal((await service.publicPage(orgA)).content.headline, content.headline);
    const saved = await tenant(() => service.get());
    const before = await prisma.organizationPage.findUniqueOrThrow({ where: { organizationId: orgA } });
    await assert.rejects(() => tenant(() => service.update({ content, version: saved.version, publication: "unpublish" }), orgA, "missing-actor"));
    assert.deepEqual(await prisma.organizationPage.findUniqueOrThrow({ where: { organizationId: orgA } }), before, "Failed transactional audit must preserve draft and publication");
    const races = await Promise.allSettled([save(saved.version, "keep", { ...content, headline: "Editor one" }), save(saved.version, "keep", { ...content, headline: "Editor two" })]);
    assert.equal(races.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(races.find((result) => result.status === "rejected").reason.statusCode, 409);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: orgA, entity: "OrganizationPage" } });
    assert.equal(audits.length, 4);
    assert.ok(audits.every((row) => row.scope === "TENANT" && row.actorId === adminA));
    await assert.rejects(() => prisma.organizationPage.create({ data: { organizationId: "missing-org", draft: content } }));

    const app = express(); app.use(express.json(), withRequestContext, apiLimiter); app.use("/api/organization", organizationPageRoutes); app.use(errorHandler);
    const token = (id, organizationId) => generateAccessToken({ id, organizationId, email: `${id}@example.invalid`, firstName: "Website", lastName: "Fixture", role: "Admin" });
    const authA = token(adminA, orgB), authB = token(adminB, orgA), authStaff = token(staff, orgB);
    const path = "/api/organization/page", publicPath = `/api/organization/public-page/${orgA}`;
    assert.equal((await request(app).get(path)).status, 401);
    assert.equal((await request(app).get(path).auth(authStaff, { type: "bearer" })).status, 403);
    assert.equal((await request(app).put(path).auth(authStaff, { type: "bearer" }).send({ content, version: null, publication: "publish" })).status, 403);
    const a = await request(app).get(path).auth(authA, { type: "bearer" }); assert.equal(a.body.data.organizationId, orgA);
    const b = await request(app).get(path).auth(authB, { type: "bearer" }); assert.equal(b.body.data.organizationId, orgB); assert.equal(b.body.data.version, null);
    assert.equal((await request(app).get(`${path}?organizationId=${orgB}`).auth(authA, { type: "bearer" })).status, 400);
    const publicResponse = await request(app).get(publicPath); assert.equal(publicResponse.status, 200);
    assert.deepEqual(Object.keys(publicResponse.body.data).sort(), ["content", "logoUrl", "name", "primaryColor", "slug"]);
    assert.equal(publicResponse.body.data.content.headline, content.headline);
    assert.equal(publicResponse.headers["cache-control"], "no-store");
    const unpublish = await request(app).put(path).auth(authA, { type: "bearer" }).send({ content, version: a.body.data.version, publication: "unpublish" }); assert.equal(unpublish.status, 200);
    assert.equal((await request(app).get(publicPath)).status, 404);
    await save(unpublish.body.data.version, "publish");
    await prisma.organization.update({ where: { id: orgA }, data: { status: "SUSPENDED" } });
    assert.equal((await request(app).get(publicPath)).status, 404);
    console.log("Website MySQL fixtures and immutable audits retained in the isolated test database.");
  } finally { await prisma.$disconnect(); await redis.quit(); }
});
