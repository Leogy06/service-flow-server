import "dotenv/config";
import process from "node:process";
import console from "node:console";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import express from "express";
import request from "supertest";

const databaseName = process.env.DATABASE_NAME ?? "";
if (process.env.RUN_DB_PLATFORM_TESTS !== "1" || process.env.NODE_ENV !== "test" ||
    !/^service_flow_platform_test_[a-z0-9_]+$/.test(databaseName) || process.env.PLATFORM_TEST_DATABASE_NAME !== databaseName ||
    decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) !== databaseName) {
  throw new Error("Use the isolated branding MySQL runner with matching test database settings");
}
const directory = await mkdtemp(join(tmpdir(), "service-flow-branding-mysql-"));
process.env.BRANDING_UPLOAD_DIR = directory;
const { prisma } = await import("../../src/lib/prisma.ts");
const { redis } = await import("../../src/lib/redis.ts");
const { brandingService } = await import("../../src/modules/organization/branding.service.ts");
const { brandingRoutes } = await import("../../src/modules/organization/branding.routes.ts");
const { requestContext } = await import("../../src/lib/requestContext.ts");
const { withRequestContext } = await import("../../src/middleware/requestContext.middleware.ts");
const { errorHandler } = await import("../../src/middleware/errorHandler.ts");
const { generateAccessToken } = await import("../../src/utils/tokens.ts");
const { apiLimiter } = await import("../../src/middleware/rateLimiter.ts");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=", "base64");

test("real MySQL tenant branding isolation, concurrent upserts, audit rollback, uploads and HTTP authorization", { timeout: 90000 }, async () => {
  const tag = randomUUID(), orgA = `brand-a-${tag}`, orgB = `brand-b-${tag}`;
  const adminA = `brand-admin-a-${tag}`, adminB = `brand-admin-b-${tag}`, staff = `brand-staff-${tag}`, operator = `brand-platform-${tag}`;
  const roleA = `brand-role-a-${tag}`, roleB = `brand-role-b-${tag}`, roleStaff = `brand-role-staff-${tag}`, rolePlatform = `brand-role-platform-${tag}`;
  const tenant = (work, organizationId = orgA, userId = adminA, role = "Admin") => requestContext.run({ requestId: `brand-${tag}`, organizationId, userId, role }, work);
  try {
    await prisma.organization.createMany({ data: [orgA, orgB].map((id) => ({ id, slug: id, name: id })) });
    await prisma.role.createMany({ data: [
      { id: roleA, name: "Admin", organizationId: orgA }, { id: roleB, name: "Tenant Admin", organizationId: orgB },
      { id: roleStaff, name: "Staff", organizationId: orgA }, { id: rolePlatform, name: "Branding platform fixture" },
    ] });
    await prisma.user.createMany({ data: [
      { id: adminA, organizationId: orgA, roleId: roleA }, { id: adminB, organizationId: orgB, roleId: roleB },
      { id: staff, organizationId: orgA, roleId: roleStaff }, { id: operator, roleId: rolePlatform, platformRole: "SYSTEM_ADMIN" },
    ].map((row) => ({ ...row, email: `${row.id}@example.invalid`, firstName: "Branding", lastName: "Fixture", status: "ACTIVE" })) });
    assert.deepEqual(await tenant(() => brandingService.get()), { organizationId: orgA, primaryColor: "#0d887d", displayName: null, logoUrl: null, faviconUrl: null, createdAt: null, updatedAt: null });
    assert.equal(await prisma.organizationSettings.count({ where: { organizationId: orgA } }), 0);
    // Omitted color exercises the migrated database default, independently of the service fallback.
    const databaseDefault = await prisma.organizationSettings.create({ data: { organizationId: orgB } });
    assert.equal(databaseDefault.primaryColor, "#0d887d");
    const races = await Promise.allSettled(["#112233", "#445566"].map((primaryColor) => tenant(() => brandingService.update({ primaryColor }))));
    assert.ok(races.some((result) => result.status === "fulfilled"));
    assert.equal(await prisma.organizationSettings.count({ where: { organizationId: orgA } }), 1);
    assert.ok(["#112233", "#445566"].includes((await tenant(() => brandingService.get())).primaryColor));
    await tenant(() => brandingService.update({ primaryColor: "#123456", displayName: "Business A" }));
    await tenant(() => brandingService.update({ primaryColor: "#abcdef", displayName: "Business B" }), orgB, adminB, "Tenant Admin");
    assert.equal((await tenant(() => brandingService.get())).displayName, "Business A");
    assert.equal((await tenant(() => brandingService.get(), orgB, adminB)).primaryColor, "#abcdef");
    const auditRows = await prisma.auditLog.findMany({ where: { organizationId: orgA, entity: "OrganizationSettings" } });
    assert.ok(auditRows.length >= 2);
    assert.ok(auditRows.every((row) => row.scope === "TENANT" && row.actorId === adminA && row.entityId === orgA));
    await assert.rejects(() => prisma.organizationSettings.create({ data: { organizationId: `missing-${tag}` } }));
    const before = await prisma.organizationSettings.findUniqueOrThrow({ where: { organizationId: orgA } });
    await assert.rejects(() => tenant(() => brandingService.update({ primaryColor: "#654321" }), orgA, `missing-user-${tag}`));
    assert.deepEqual(await prisma.organizationSettings.findUniqueOrThrow({ where: { organizationId: orgA } }), before);
    await assert.rejects(() => tenant(() => brandingService.update({ primaryColor: "#654321" }), orgA, staff, "Staff"), { statusCode: 403 });

    const app = express(); app.use(express.json(), withRequestContext, apiLimiter); app.use("/api/organization", brandingRoutes); app.use(errorHandler);
    // Deliberately forged tenant/role claims cannot override persisted authorization.
    const token = (id, organizationId) => generateAccessToken({ id, organizationId, email: `${id}@example.invalid`, firstName: "Branding", lastName: "Fixture", role: "Admin" });
    const authA = token(adminA, orgB), authB = token(adminB, orgA), authStaff = token(staff, orgB);
    const path = "/api/organization/settings";
    assert.equal((await request(app).get(path)).status, 401);
    const staffRead = await request(app).get(path).auth(authStaff, { type: "bearer" });
    assert.equal(staffRead.status, 200); assert.equal(staffRead.body.data.organizationId, orgA);
    assert.equal((await request(app).patch(path).auth(authStaff, { type: "bearer" }).send({ primaryColor: "#000000" })).status, 403);
    assert.equal((await request(app).get(path).auth(token(operator, orgA), { type: "bearer" })).status, 403);
    assert.equal((await request(app).get(`${path}?organizationId=${orgB}`).auth(authA, { type: "bearer" })).status, 400);
    assert.equal((await request(app).patch(path).auth(authA, { type: "bearer" }).send({ organizationId: orgB, primaryColor: "#000000" })).status, 400);
    const tenantB = await request(app).get(path).auth(authB, { type: "bearer" }); assert.equal(tenantB.body.data.organizationId, orgB); assert.equal(tenantB.body.data.primaryColor, "#abcdef");
    const uploaded = await request(app).post(`${path}/logo`).auth(authA, { type: "bearer" }).type("png").send(png);
    assert.equal(uploaded.status, 200); assert.match(uploaded.body.data.logoUrl, /^\/api\/organization\/branding-assets\/[a-f0-9]{64}\.png$/);
    const image = await request(app).get(uploaded.body.data.logoUrl); assert.equal(image.status, 200); assert.equal(image.headers["content-type"], "image/png");
    const assetRaces = await Promise.allSettled([1, 2].map(() => tenant(() => brandingService.upload("logo", png, "image/png")))); assert.ok(assetRaces.some((result) => result.status === "fulfilled"));
    const current = await tenant(() => brandingService.get()); assert.deepEqual(await readFile(join(directory, current.logoUrl.split("/").at(-1))), png);
    const removed = await request(app).delete(`${path}/logo`).auth(authA, { type: "bearer" }); assert.equal(removed.status, 200); assert.equal(removed.body.data.logoUrl, null); assert.equal(removed.body.data.displayName, "Business A");
    assert.equal((await request(app).patch(path).auth(authA, { type: "bearer" }).send({ primaryColor: null, displayName: null })).status, 200);
    assert.equal((await tenant(() => brandingService.get())).primaryColor, "#0d887d"); assert.equal((await tenant(() => brandingService.get(), orgB, adminB)).primaryColor, "#abcdef");
    console.log("Branding MySQL fixtures and immutable audits retained in isolated test database.");
  } finally {
    await prisma.$disconnect(); await redis.quit();
    // mkdtemp returns an absolute directory with a fixed prefix under the OS temp root.
    assert.ok(resolve(directory).startsWith(resolve(tmpdir(), "service-flow-branding-mysql-")));
    await rm(directory, { recursive: true, force: true });
  }
});
