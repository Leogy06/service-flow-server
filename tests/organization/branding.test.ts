import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OrganizationSettings } from "../../src/generated/prisma/client.js";

const directory = await mkdtemp(join(tmpdir(), "service-flow-branding-"));
let rows = new Map<string, OrganizationSettings>();
let audits: unknown[] = [];
let failAudit = false;
const organizations = new Map([["org-a", "ACTIVE"], ["org-b", "ACTIVE"]]);
type SettingWhere = { organization?: { status: string }; OR: Array<{ logoUrl?: string; faviconUrl?: string }> };
const matches = (row: OrganizationSettings, where: SettingWhere) => (!where.organization || organizations.get(row.organizationId) === where.organization.status) && where.OR.some((part) => Object.entries(part).every(([key, value]) => Reflect.get(row, key) === value));
const db = {
  organization: { findUnique: jest.fn(async ({ where, select }: { where: { id: string; status: string }; select: { settings?: boolean } }) => organizations.get(where.id) === where.status ? select.settings ? { settings: rows.get(where.id) ?? null } : { id: where.id } : null) },
  organizationSettings: {
    findUnique: jest.fn(async ({ where }: { where: { organizationId: string } }) => rows.get(where.organizationId) ?? null),
    findFirst: jest.fn(async ({ where }: { where: SettingWhere }) => [...rows.values()].find((row) => matches(row, where)) ?? null),
    upsert: jest.fn(async ({ where, create, update }: { where: { organizationId: string }; create: Partial<OrganizationSettings>; update: Partial<OrganizationSettings> }) => {
      const existing = rows.get(where.organizationId);
      const row: OrganizationSettings = existing ? { ...existing, ...update, updatedAt: new Date() } : { organizationId: where.organizationId, primaryColor: "#b91c1c", displayName: null, logoUrl: null, faviconUrl: null, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.set(row.organizationId, row); return row;
    }),
  },
  auditLog: { create: jest.fn(async ({ data }: { data: unknown }) => { if (failAudit) throw new Error("Audit failed"); audits.push(data); return {}; }) },
};
const prisma = {
  ...db,
  user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
    const platform = where.id === "operator", organizationId = where.id === "admin-b" ? "org-b" : "org-a";
    return {
      id: where.id, email: "test@example.invalid", firstName: "Test", lastName: "Member", status: "ACTIVE", deletedAt: null,
      platformRole: platform ? "SYSTEM_ADMIN" : "NONE", securityStatus: "ACTIVE", sessionVersion: 0,
      organizationId: platform ? null : organizationId, organization: platform ? null : { id: organizationId, status: organizations.get(organizationId), billingEnabled: false },
      role: { id: "role-a", name: where.id === "staff" ? "Staff" : "Admin", organizationId: platform ? null : organizationId, deletedAt: null, permissions: [] }, userPermissions: [],
    };
  }) },
  $transaction: async <T>(work: (tx: typeof db) => Promise<T>) => {
    const before = structuredClone({ rows, audits });
    try { return await work(db); } catch (error) { ({ rows, audits } = before); throw error; }
  },
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: {} }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ invalidateCache: jest.fn() }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (token: string) => ({ sub: token, sessionVersion: 0 }) }));
jest.unstable_mockModule("rate-limit-redis", async () => { const { MemoryStore } = await import("express-rate-limit"); return { RedisStore: class extends MemoryStore { constructor() { super(); } } }; });
jest.unstable_mockModule("@/config/env.js", () => ({ env: {
  BRANDING_UPLOAD_DIR: directory,
  BRANDING_UPLOAD_RATE_LIMIT_WINDOW_MS: 60000, BRANDING_UPLOAD_RATE_LIMIT_MAX: 2,
  BRANDING_ASSET_RATE_LIMIT_WINDOW_MS: 60000, BRANDING_ASSET_RATE_LIMIT_MAX: 2,
  FEEDBACK_RATE_LIMIT_WINDOW_MS: 60000, FEEDBACK_RATE_LIMIT_MAX: 2,
  REFUND_RATE_LIMIT_WINDOW_MS: 60000, REFUND_RATE_LIMIT_MAX: 2,
  SIGNUP_RATE_LIMIT_WINDOW_MS: 60000, SIGNUP_RATE_LIMIT_MAX: 2,
} }));
const { requestContext } = await import("@/lib/requestContext.js");
const { brandingService: service } = await import("@/modules/organization/branding.service.js");
const { brandingRoutes } = await import("@/modules/organization/branding.routes.js");
const { brandingUpdateSchema } = await import("@/modules/organization/branding.schema.js");
const { validateBrandingImage, BRANDING_MAX_BYTES } = await import("@/modules/organization/branding-assets.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { apiLimiter, writeLimmiter, brandingUploadLimiter, brandingAssetLimiter } = await import("@/middleware/rateLimiter.js");
const { ipKeyGenerator } = await import("express-rate-limit");
const app = express();
app.use(express.json(), withRequestContext, apiLimiter);
app.use("/api/organization", brandingRoutes);
app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);
const path = "/api/organization/settings";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0WQAAAAASUVORK5CYII=", "base64");
const asTenant = <T>(work: () => Promise<T>, organizationId = "org-a", role = "Admin") => requestContext.run({ requestId: "branding-test", userId: "user-a", organizationId, role }, work);
beforeEach(async () => {
  jest.clearAllMocks(); rows = new Map(); audits = []; failAudit = false; organizations.set("org-a", "ACTIVE");
  for (const filename of await readdir(directory)) await rm(join(directory, filename));
  for (const ip of ["::ffff:127.0.0.1", "127.0.0.1", "::1"]) for (const limiter of [apiLimiter, writeLimmiter, brandingAssetLimiter]) await limiter.resetKey(ipKeyGenerator(ip));
  for (const id of ["admin", "admin-b", "staff"]) await brandingUploadLimiter.resetKey(id);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

test("tenant reads return defaults without writes, and persist isolated partial updates", async () => {
  expect(await asTenant(() => service.get(), "org-a", "Staff")).toEqual({ organizationId: "org-a", primaryColor: "#b91c1c", displayName: null, logoUrl: null, faviconUrl: null, createdAt: null, updatedAt: null });
  expect(db.organizationSettings.upsert).not.toHaveBeenCalled();
  await asTenant(() => service.update({ primaryColor: "#123456", displayName: "Business A" }));
  await asTenant(() => service.update({ primaryColor: "#abcdef" }), "org-b");
  expect(await asTenant(() => service.get())).toMatchObject({ primaryColor: "#123456", displayName: "Business A" });
  expect(await asTenant(() => service.get(), "org-b")).toMatchObject({ primaryColor: "#abcdef", displayName: null });
  await asTenant(() => service.update({ primaryColor: null }));
  expect(rows.get("org-a")).toMatchObject({ primaryColor: "#b91c1c", displayName: "Business A" });
  await asTenant(() => service.update({ displayName: null })); expect(rows.get("org-a")!.displayName).toBeNull();
  expect(audits).toHaveLength(4); expect(audits[0]).toMatchObject({ organizationId: "org-a", actorId: "user-a", entity: "OrganizationSettings" });
});
test("service rejects staff mutations, platform and missing contexts, and inactive tenants", async () => {
  await expect(asTenant(() => service.update({ primaryColor: "#123456" }), "org-a", "Staff")).rejects.toMatchObject({ statusCode: 403 });
  await expect(service.get()).rejects.toMatchObject({ statusCode: 403 });
  await expect(requestContext.run({ requestId: "test", userId: "operator", role: "System Admin" }, () => service.update({ primaryColor: "#123456" }))).rejects.toMatchObject({ statusCode: 403 });
  organizations.set("org-a", "SUSPENDED"); await expect(asTenant(() => service.get())).rejects.toMatchObject({ statusCode: 404 });
  await expect(asTenant(() => service.update({ primaryColor: "#123456" }))).rejects.toMatchObject({ statusCode: 404 });
  expect(rows.size).toBe(0);
});
test("strict validation rejects mass assignment and invalid colors/names", () => {
  for (const body of [{}, { primaryColor: "red" }, { primaryColor: "#fff" }, { primaryColor: "#123456;" }, { displayName: " " }, { displayName: "x".repeat(101) }, { displayName: "x\ny" }, { organizationId: "org-b", primaryColor: "#123456" }, { logoUrl: "https://example.com" }, { faviconUrl: "javascript:alert(1)" }]) expect(brandingUpdateSchema.safeParse({ query: {}, body }).success).toBe(false);
  expect(brandingUpdateSchema.parse({ query: {}, body: { primaryColor: "#ABCDEF", displayName: " Business A " } }).body).toEqual({ primaryColor: "#abcdef", displayName: "Business A" });
});
test("uploads are opaque, publicly readable, replace safely and reset without changing other settings", async () => {
  await asTenant(() => service.update({ primaryColor: "#123456", displayName: "Business A" }));
  const first = await asTenant(() => service.upload("logo", png, "image/png"));
  expect(first.logoUrl).toMatch(/^\/api\/organization\/branding-assets\/[a-f0-9]{64}\.png$/);
  expect((await service.asset(first.logoUrl!.split("/").at(-1)!)).data).toEqual(png);
  expect(await readFile(join(directory, first.logoUrl!.split("/").at(-1)!))).toEqual(png);
  const second = await asTenant(() => service.upload("logo", png, "image/png")); expect(second.logoUrl).not.toBe(first.logoUrl);
  expect(await readdir(directory)).toEqual([second.logoUrl!.split("/").at(-1)!]);
  await expect(service.asset(first.logoUrl!.split("/").at(-1)!)).rejects.toMatchObject({ statusCode: 404 });
  await asTenant(() => service.upload("favicon", png, "image/png"));
  const removed = await asTenant(() => service.remove("logo")); expect(removed).toMatchObject({ logoUrl: null, primaryColor: "#123456", displayName: "Business A", faviconUrl: expect.any(String) });
  expect(await readdir(directory)).toHaveLength(1);
});
test("audit failures roll back settings, retain previous assets and remove new orphan files", async () => {
  const first = await asTenant(() => service.upload("logo", png, "image/png")); const before = [...rows];
  failAudit = true;
  await expect(asTenant(() => service.update({ displayName: "Rejected" }))).rejects.toThrow("Audit failed"); expect([...rows]).toEqual(before);
  await expect(asTenant(() => service.upload("logo", png, "image/png"))).rejects.toThrow("Audit failed");
  expect(await readdir(directory)).toEqual([first.logoUrl!.split("/").at(-1)!]);
  await expect(asTenant(() => service.remove("logo"))).rejects.toThrow("Audit failed"); expect(rows.get("org-a")!.logoUrl).toBe(first.logoUrl);
});
test("cleanup preserves assets referenced by another setting", async () => {
  const first = await asTenant(() => service.upload("logo", png, "image/png"));
  rows.set("org-b", { ...rows.get("org-a")!, organizationId: "org-b" });
  await asTenant(() => service.remove("logo")); expect(await readdir(directory)).toHaveLength(1);
  expect((await service.asset(first.logoUrl!.split("/").at(-1)!)).data).toEqual(png);
});
test("uploads reject unsupported, spoofed, truncated, animated, oversized and overdimensioned images", () => {
  expect(validateBrandingImage(png, "image/png", "logo")).toEqual({ extension: "png", contentType: "image/png" });
  for (const [bytes, mime, kind] of [[Buffer.from("<svg/>"), "image/svg+xml", "logo"], [png, "image/jpeg", "logo"], [png.subarray(0, 40), "image/png", "logo"], [Buffer.alloc(BRANDING_MAX_BYTES + 1), "image/png", "logo"], [png, "image/webp", "favicon"]] as const) expect(() => validateBrandingImage(bytes, mime, kind)).toThrow();
  const huge = Buffer.from(png); huge.writeUInt32BE(2049, 16); expect(() => validateBrandingImage(huge, "image/png", "logo")).toThrow();
  const trailing = Buffer.concat([png, Buffer.from("<html>")]); expect(() => validateBrandingImage(trailing, "image/png", "logo")).toThrow();
  const animationChunk = Buffer.alloc(12); animationChunk.write("acTL", 4); const animated = Buffer.concat([png.subarray(0, 33), animationChunk, png.subarray(33)]); expect(() => validateBrandingImage(animated, "image/png", "logo")).toThrow();
});
test("image metadata without actual image payload is rejected", () => {
  const webp = Buffer.alloc(30); webp.write("RIFF"); webp.writeUInt32LE(22, 4); webp.write("WEBP", 8); webp.write("VP8X", 12); webp.writeUInt32LE(10, 16);
  expect(() => validateBrandingImage(webp, "image/webp", "logo")).toThrow();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1, 1, 0xff, 0xd9]);
  expect(() => validateBrandingImage(jpeg, "image/jpeg", "logo")).toThrow();
  const corrupted = Buffer.from(png); corrupted[41] = 0;
  expect(() => validateBrandingImage(corrupted, "image/png", "logo")).toThrow();
});
test.each([["get", ""], ["patch", ""], ["post", "/logo"], ["delete", "/logo"], ["post", "/favicon"], ["delete", "/favicon"]] as const)("%s settings%s requires authentication", async (method, suffix) => { expect((await request(app)[method](`${path}${suffix}`).send({ primaryColor: "#123456" })).status).toBe(401); });
test("HTTP reads allow staff; role-gated writes and platform reads fail; tenant selectors are rejected", async () => {
  expect((await request(app).get(path).auth("staff", { type: "bearer" })).status).toBe(200);
  expect((await request(app).patch(path).auth("staff", { type: "bearer" }).send({ primaryColor: "#123456" })).status).toBe(403);
  expect((await request(app).post(`${path}/logo`).auth("staff", { type: "bearer" }).type("png").send(png)).status).toBe(403);
  expect((await request(app).get(path).auth("operator", { type: "bearer" })).status).toBe(403);
  expect((await request(app).get(`${path}?organizationId=org-b`).auth("admin", { type: "bearer" })).status).toBe(400);
  expect((await request(app).patch(path).auth("admin", { type: "bearer" }).send({ organizationId: "org-b", primaryColor: "#123456" })).status).toBe(400);
  const saved = await request(app).patch(path).auth("admin", { type: "bearer" }).send({ primaryColor: "#ABCDEF" }); expect(saved.status).toBe(200); expect(saved.body.data).toMatchObject({ organizationId: "org-a", primaryColor: "#abcdef" }); expect(saved.headers["cache-control"]).toBe("no-store");
  const foreign = await request(app).get(path).auth("admin-b", { type: "bearer" }); expect(foreign.body.data).toMatchObject({ organizationId: "org-b", primaryColor: "#b91c1c" });
});
test("HTTP upload, public raster headers, size limits and traversal validation", async () => {
  const saved = await request(app).post(`${path}/logo`).auth("admin", { type: "bearer" }).type("png").send(png);
  expect(saved.status).toBe(200); const asset = await request(app).get(saved.body.data.logoUrl); expect(asset.status).toBe(200); expect(asset.headers).toMatchObject({ "content-type": "image/png", "x-content-type-options": "nosniff", "cache-control": "public, max-age=31536000, immutable", "cross-origin-resource-policy": "cross-origin" });
  expect((await request(app).get("/api/organization/branding-assets/invalid.svg")).status).toBe(400);
  const large = await request(app).post(`${path}/logo`).auth("admin", { type: "bearer" }).type("png").send(Buffer.alloc(BRANDING_MAX_BYTES + 1)); expect(large.status).toBe(413);
});
test("upload and public asset limits return 429 with Retry-After", async () => {
  for (let index = 0; index < 2; index++) expect((await request(app).post(`${path}/logo`).auth("admin", { type: "bearer" }).type("png").send(png)).status).toBe(200);
  const blocked = await request(app).post(`${path}/logo`).auth("admin", { type: "bearer" }).type("png").send(png); expect(blocked.status).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  const assetUrl = rows.get("org-a")!.logoUrl!;
  for (let index = 0; index < 2; index++) expect((await request(app).get(assetUrl)).status).toBe(200);
  const assetBlocked = await request(app).get(assetUrl); expect(assetBlocked.status).toBe(429); expect(Number(assetBlocked.headers["retry-after"])).toBeGreaterThan(0);
});
test("settings mutations retain the shared write limiter and Retry-After", async () => {
  for (let index = 0; index < 30; index++) expect((await request(app).patch(path).auth("admin", { type: "bearer" }).send({ primaryColor: "#123456" })).status).toBe(200);
  const blocked = await request(app).patch(path).auth("admin", { type: "bearer" }).send({ primaryColor: "#123456" }); expect(blocked.status).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0); expect(audits).toHaveLength(30);
});
