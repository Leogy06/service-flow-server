import { jest } from "@jest/globals";
import express from "express";
import { MemoryStore } from "express-rate-limit";
import request from "supertest";
import type { OrganizationPage } from "../../src/generated/prisma/client.js";
import { rateLimitEnvironmentSchema } from "../../src/config/rate-limit.js";

let rows = new Map<string, OrganizationPage>();
let audits: unknown[] = [];
let hasSettings = true;
let failAudit = false;
const organizations = new Map([["org-a", "ACTIVE"], ["org-b", "ACTIVE"]]);
const db = {
  organization: { findUnique: jest.fn(async ({ where }: { where: { id?: string; slug?: string; status: string } }) => {
    const id = where.id ?? where.slug;
    if (!id || organizations.get(id) !== where.status) return null;
    return { id, slug: id, name: `Business ${id}`, page: rows.get(id) ?? null, settings: hasSettings ? { displayName: null, primaryColor: "#123456", logoUrl: null } : null };
  }) },
  organizationPage: {
    findUnique: jest.fn(async ({ where }: { where: { organizationId: string } }) => rows.get(where.organizationId) ?? null),
    upsert: jest.fn(async ({ where, create, update }: { where: { organizationId: string }; create: Partial<OrganizationPage>; update: Partial<OrganizationPage> }) => {
      const row = { organizationId: where.organizationId, published: null, publishedAt: null, createdAt: new Date(), ...rows.get(where.organizationId), ...(rows.has(where.organizationId) ? update : create) } as OrganizationPage;
      rows.set(row.organizationId, row); return row;
    }),
  },
  auditLog: { create: jest.fn(async ({ data }: { data: unknown }) => { if (failAudit) throw new Error("Audit failed"); audits.push(data); return {}; }) },
};
const prisma = {
  ...db,
  user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
    const platform = where.id === "operator", organizationId = where.id === "admin-b" ? "org-b" : "org-a";
    return { id: where.id, email: "test@example.invalid", firstName: "Test", lastName: "Member", status: "ACTIVE", deletedAt: null,
      platformRole: platform ? "SYSTEM_ADMIN" : "NONE", securityStatus: "ACTIVE", sessionVersion: 0,
      organizationId: platform ? null : organizationId, organization: platform ? null : { id: organizationId, status: organizations.get(organizationId), billingEnabled: false },
      role: { id: "role", name: where.id === "staff" ? "Staff" : "Admin", organizationId: platform ? null : organizationId, deletedAt: null, permissions: [] }, userPermissions: [] };
  }) },
  $transaction: async <T>(work: (tx: typeof db) => Promise<T>) => {
    const before = structuredClone({ rows, audits });
    try { return await work(db); } catch (error) { ({ rows, audits } = before); throw error; }
  },
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger: { warn: jest.fn(), error: jest.fn() } }));
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: {}, redisReady: async () => {} }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn() }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (token: string) => ({ sub: token, sessionVersion: 0 }) }));
jest.unstable_mockModule("rate-limit-redis", () => ({ RedisStore: class extends MemoryStore { constructor() { super(); } } }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { ...rateLimitEnvironmentSchema.parse({}), APP_ENV: "test", PUBLIC_PAGE_RATE_LIMIT_WINDOW_MS: 60000, PUBLIC_PAGE_RATE_LIMIT_MAX: 2 } }));
const { requestContext } = await import("@/lib/requestContext.js");
const { organizationPageService: service } = await import("@/modules/organization/page.service.js");
const { organizationPageRoutes } = await import("@/modules/organization/page.routes.js");
const { pageContentSchema, pageUpdateSchema, emptyPageContent } = await import("@/modules/organization/page.schema.js");
const { organizationSchema } = await import("@/modules/organization/organization.schema.js");
const { registerSchema } = await import("@/modules/auth/auth.schema.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { apiLimiter, writeLimmiter, publicPageLimiter } = await import("@/middleware/rateLimiter.js");
const { ipKeyGenerator } = await import("express-rate-limit");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/api/organization", organizationPageRoutes);
app.use(((error, _req, res, _next) => res.status(error.statusCode ?? 500).json({ error: error.message })) as express.ErrorRequestHandler);
const path = "/api/organization/page";
const publicPath = "/api/organization/public-page/org-a";
const tenant = <T>(work: () => Promise<T>, organizationId = "org-a", role = "Admin") => requestContext.run({ requestId: "page-test", userId: "admin", organizationId, role }, work);
const legacyContent = { headline: "Electrical services", about: "We maintain and repair electrical systems.", services: [{ name: "Repairs", description: "Home electrical repairs." }], address: "Sample City", serviceArea: "", hours: "", phone: "09170000000", email: "" };
const content = pageContentSchema.parse(legacyContent);
const input = (version: string | null = null, publication: "keep" | "publish" | "unpublish" = "keep") => ({ content, version, publication });
beforeEach(async () => {
  hasSettings = true;
  jest.clearAllMocks(); rows = new Map(); audits = []; failAudit = false; organizations.set("org-a", "ACTIVE");
  for (const ip of ["::ffff:127.0.0.1", "127.0.0.1", "::1"]) for (const limiter of [apiLimiter, writeLimmiter, publicPageLimiter]) await limiter.resetKey(ipKeyGenerator(ip));
  for (const id of ["admin", "admin-b", "staff", "operator"]) for (const limiter of [apiLimiter, writeLimmiter]) await limiter.resetKey(`u:${id}`);
});

test("new tenant has an empty private draft without writes", async () => {
  expect(await tenant(() => service.get())).toMatchObject({ organizationId: "org-a", content: emptyPageContent(), publishedAt: null, version: null });
  expect(db.organizationPage.upsert).not.toHaveBeenCalled();
  await expect(service.publicPage("org-a")).rejects.toMatchObject({ statusCode: 404 });
});

test("public pages use teal only when tenant branding is absent", async () => {
  await tenant(() => service.update(input(null, "publish")));
  expect((await service.publicPage("org-a")).primaryColor).toBe("#123456");
  hasSettings = false;
  expect((await service.publicPage("org-a")).primaryColor).toBe("#0d887d");
});

test("existing draft and published JSON snapshots receive optional profile defaults without a migration", async () => {
  const now = new Date();
  rows.set("org-a", { organizationId: "org-a", draft: legacyContent, published: legacyContent, publishedAt: now, createdAt: now, updatedAt: now });
  expect((await tenant(() => service.get())).content).toEqual(content);
  expect((await service.publicPage("org-a")).content).toEqual(content);
  expect(db.organizationPage.upsert).not.toHaveBeenCalled();
});

test("older clients can omit optional public links when saving or publishing", async () => {
  const saved = await request(app).put(path).auth("admin", { type: "bearer" }).send({ ...input(null, "publish"), content: legacyContent });
  expect(saved.status).toBe(200);
  for (const field of ["coverImageUrl", "facebookUrl", "instagramUrl", "linkedinUrl", "googleMapsUrl"]) expect(saved.body.data.content[field]).toBe("");
  expect((await service.publicPage("org-a")).content).toEqual(content);
});

test("public photos and online profiles follow draft and publication isolation", async () => {
  const liveContent = { ...content, coverImageUrl: "https://images.example.invalid/team.jpg", facebookUrl: "https://www.facebook.com/example", instagramUrl: "https://instagram.com/example", linkedinUrl: "https://www.linkedin.com/company/example", googleMapsUrl: "https://maps.app.goo.gl/example" };
  const live = await tenant(() => service.update({ ...input(null, "publish"), content: liveContent }));
  await tenant(() => service.update({ ...input(live.version), content: { ...liveContent, facebookUrl: "https://facebook.com/draft", coverImageUrl: "" } }));
  expect((await service.publicPage("org-a")).content).toEqual(liveContent);
  expect((await tenant(() => service.get(), "org-b")).content.facebookUrl).toBe("");
});

test.each([
  ["coverImageUrl", "https://images.example.invalid/our-team.jpg?width=1600"],
  ["facebookUrl", "https://facebook.com/example"], ["facebookUrl", "https://www.fb.com/example"],
  ["instagramUrl", "https://www.instagram.com/example/"], ["linkedinUrl", "https://linkedin.com/company/example"],
  ["googleMapsUrl", "https://www.google.com/maps/place/Example"], ["googleMapsUrl", "https://google.com/maps?q=Example"],
  ["googleMapsUrl", "https://maps.google.com/?q=Example"], ["googleMapsUrl", "https://maps.app.goo.gl/example"],
  ["googleMapsUrl", "https://goo.gl/maps/example"],
])("public link validation accepts intended HTTPS %s URLs", (field, value) => {
  expect(pageContentSchema.safeParse({ ...legacyContent, [field]: value }).success).toBe(true);
});

test.each([
  ["coverImageUrl", "http://images.example.invalid/photo.jpg"], ["coverImageUrl", "javascript:alert(1)"],
  ["coverImageUrl", "data:image/png;base64,abc"], ["coverImageUrl", "https://user:password@images.example.invalid/photo.jpg"],
  ["coverImageUrl", "https://images.example.invalid:8443/photo.jpg"], ["coverImageUrl", `https://images.example.invalid/${"x".repeat(2048)}`],
  ["coverImageUrl", "https://images.example.invalid/line\nfeed.jpg"], ["coverImageUrl", "https://images.example.invalid/back\\slash.jpg"],
  ["facebookUrl", "https://facebook.com.evil.invalid/example"], ["facebookUrl", "https://evil.invalid/facebook.com"],
  ["facebookUrl", "https://facebook.com@evil.invalid/example"], ["facebookUrl", "https://evil.invalid@facebook.com/example"],
  ["facebookUrl", "https://m.facebook.com/example"], ["instagramUrl", "https://instagram.example.invalid/example"],
  ["linkedinUrl", "https://linkedin.com.evil.invalid/company/example"],
  ["googleMapsUrl", "https://google.com/search?q=Example"], ["googleMapsUrl", "https://google.com/maps-evil/example"],
  ["googleMapsUrl", "https://maps.google.com.evil.invalid/"], ["googleMapsUrl", "https://goo.gl/unrelated"],
])("public link validation rejects unsafe or unrelated %s URL %s", (field, value) => {
  expect(pageContentSchema.safeParse({ ...legacyContent, [field]: value }).success).toBe(false);
});
test("workspace provisioning and registration reserve the public business route", () => {
  for (const slug of ["business", "BUSINESS", " business "]) {
    expect(registerSchema.shape.body.shape.slug.safeParse(slug).success).toBe(false);
    expect(organizationSchema.shape.body.shape.slug.safeParse(slug).success).toBe(false);
  }
  expect(registerSchema.shape.body.shape.slug.safeParse("business-services").success).toBe(true);
});
test("draft saves are isolated and do not publish; publication uses a separate snapshot", async () => {
  const draft = await tenant(() => service.update(input()));
  await expect(service.publicPage("org-a")).rejects.toMatchObject({ statusCode: 404 });
  expect((await tenant(() => service.get(), "org-b")).content).toEqual(emptyPageContent());
  const live = await tenant(() => service.update(input(draft.version, "publish")));
  const privateContent = { ...content, headline: "PRIVATE DRAFT" };
  await tenant(() => service.update({ ...input(live.version), content: privateContent }));
  expect((await service.publicPage("org-a")).content.headline).toBe(content.headline);
  expect((await tenant(() => service.get())).content.headline).toBe("PRIVATE DRAFT");
  expect(audits).toHaveLength(3); expect(audits[0]).toMatchObject({ organizationId: "org-a", actorId: "admin", entity: "OrganizationPage" });
});
test("unpublishing removes public access while preserving the draft; suspension and missing pages are indistinguishable", async () => {
  const live = await tenant(() => service.update(input(null, "publish")));
  organizations.set("org-a", "SUSPENDED");
  await expect(service.publicPage("org-a")).rejects.toMatchObject({ statusCode: 404, message: "Page not found" });
  await expect(service.publicPage("missing")).rejects.toMatchObject({ statusCode: 404, message: "Page not found" });
  organizations.set("org-a", "ACTIVE");
  await tenant(() => service.update(input(live.version, "unpublish")));
  await expect(service.publicPage("org-a")).rejects.toMatchObject({ statusCode: 404 });
  expect((await tenant(() => service.get())).content).toEqual(content);
});
test("staff, platform and absent tenant contexts cannot manage content", async () => {
  await expect(tenant(() => service.get(), "org-a", "Staff")).rejects.toMatchObject({ statusCode: 403 });
  await expect(tenant(() => service.update(input()), "org-a", "Staff")).rejects.toMatchObject({ statusCode: 403 });
  await expect(service.get()).rejects.toMatchObject({ statusCode: 403 });
  await expect(requestContext.run({ requestId: "platform", userId: "operator", role: "System Admin" }, () => service.update(input()))).rejects.toMatchObject({ statusCode: 403 });
});
test("publish requires complete public details, while incomplete drafts can be saved", async () => {
  await expect(tenant(() => service.update({ ...input(null, "publish"), content: emptyPageContent() }))).rejects.toMatchObject({ statusCode: 400 });
  expect(rows.size).toBe(0);
  const draft = await tenant(() => service.update({ ...input(), content: emptyPageContent() }));
  for (const missing of [{ headline: "" }, { about: "" }, { services: [] }, { address: "" }, { phone: "", email: "" }]) {
    await expect(tenant(() => service.update({ ...input(draft.version, "publish"), content: { ...content, ...missing } }))).rejects.toMatchObject({ statusCode: 400 });
  }
  await expect(tenant(() => service.update({ ...input(draft.version, "publish"), content: { ...content, phone: "", email: "public@example.invalid" } }))).resolves.toMatchObject({ publishedAt: expect.any(Date) });
});
test("stale versions and duplicate initial saves cannot overwrite saved or published content", async () => {
  const saved = await tenant(() => service.update(input()));
  await expect(tenant(() => service.update(input()))).rejects.toMatchObject({ statusCode: 409 });
  const next = await tenant(() => service.update(input(saved.version, "publish")));
  expect(next.version).not.toBe(saved.version);
  await expect(tenant(() => service.update(input(saved.version, "unpublish")))).rejects.toMatchObject({ statusCode: 409 });
  expect((await service.publicPage("org-a")).content).toEqual(content);
});
test("audit failure rolls back both draft and publication", async () => {
  const saved = await tenant(() => service.update(input()));
  const before = structuredClone([...rows]); failAudit = true;
  await expect(tenant(() => service.update(input(saved.version, "publish")))).rejects.toThrow("Audit failed");
  expect([...rows]).toEqual(before); expect(audits).toHaveLength(1);
});
test("public projection explicitly excludes drafts, tenant identifiers and internal data", async () => {
  await tenant(() => service.update(input(null, "publish")));
  expect(Object.keys(await service.publicPage("org-a")).sort()).toEqual(["content", "logoUrl", "name", "primaryColor", "slug"]);
  expect(db.organization.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ select: expect.objectContaining({ page: { select: { published: true, publishedAt: true } } }) }));
});
test.each([
  { organizationId: "org-b" }, { publication: "delete" }, { version: "bad" },
  { content: { ...content, organizationId: "org-b" } }, { content: { ...content, email: "bad" } },
  { content: { ...content, phone: "javascript:alert(1)" } }, { content: { ...content, headline: "x".repeat(161) } },
  { content: { ...content, phone: "-----" } }, { content: { ...content, phone: "1234567890123456" } },
  { content: { ...content, services: Array(21).fill(content.services[0]) } },
  { content: { ...content, services: [{ name: "", description: "" }] } },
])("strict schema rejects mass assignment and malformed input %j", (changes) => {
  expect(pageUpdateSchema.safeParse({ query: {}, body: { ...input(), ...changes } }).success).toBe(false);
});
test.each(["get", "put"] as const)("HTTP %s management requires authentication and tenant administration", async (method) => {
  expect((await request(app)[method](path).send(input())).status).toBe(401);
  for (const actor of ["staff", "operator"]) expect((await request(app)[method](path).auth(actor, { type: "bearer" }).send(input())).status).toBe(403);
});
test("HTTP rejects tenant selectors and only returns the authenticated tenant's draft", async () => {
  expect((await request(app).put(path).auth("admin", { type: "bearer" }).send({ ...input(), organizationId: "org-b" })).status).toBe(400);
  expect((await request(app).get(`${path}?organizationId=org-b`).auth("admin", { type: "bearer" })).status).toBe(400);
  const saved = await request(app).put(path).auth("admin", { type: "bearer" }).send(input());
  expect(saved.status).toBe(200); expect(saved.headers["cache-control"]).toBe("no-store");
  expect((await request(app).get(path).auth("admin-b", { type: "bearer" })).body.data.content).toEqual(emptyPageContent());
});
test("HTTP public access is anonymous, published only and rate limited with Retry-After", async () => {
  expect((await request(app).get(publicPath)).status).toBe(404);
  await tenant(() => service.update(input(null, "publish")));
  const live = await request(app).get(publicPath);
  expect(live.status).toBe(200); expect(live.headers["cache-control"]).toBe("no-store");
  expect(live.body.data.content).toEqual(content); expect(live.body.data.organizationId).toBeUndefined();
  const blocked = await request(app).get(publicPath);
  expect(blocked.status).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
});
test("HTTP management writes retain the shared write limiter and Retry-After", async () => {
  let version: string | null = null;
  for (let i = 0; i < 30; i++) {
    const saved: { status: number; body: { data: { version: string } } } = await request(app).put(path).auth("admin", { type: "bearer" }).send(input(version));
    expect(saved.status).toBe(200); version = saved.body.data.version;
  }
  const blocked = await request(app).put(path).auth("admin", { type: "bearer" }).send(input(version));
  expect(blocked.status).toBe(429); expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0); expect(audits).toHaveLength(30);
});
