import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import type { ProductFeedback, CustomerFeedback, FeedbackStatus } from "../../src/generated/prisma/client.js";

const now = () => new Date();
const productRow = (overrides: Partial<ProductFeedback> = {}): ProductFeedback => ({
  id: "product-a", organizationId: "org-a", authorId: "user-a", submissionKey: "12345678-1234-4234-8234-123456789012",
  rating: 4, comment: "Helpful workflow", displayName: null, consentGrantedAt: null, consentVersion: null,
  consentWithdrawnAt: null, testimonialApprovedAt: null, status: "NEW", createdAt: now(), updatedAt: now(), ...overrides,
});
const customerRow = (overrides: Partial<CustomerFeedback> = {}): CustomerFeedback => ({
  id: "customer-feedback-a", organizationId: "org-a", invitationId: "invite-a", rating: 4, comment: "Helpful workflow",
  displayName: null, consentGrantedAt: null, consentVersion: null, consentWithdrawnAt: null,
  testimonialApprovedAt: null, status: "NEW", createdAt: now(), updatedAt: now(), ...overrides,
});
const rawToken = "a".repeat(43);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let products: ProductFeedback[] = [];
let responses: CustomerFeedback[] = [];
let auditRows: unknown[] = [];
let failAudit = false;
let invitationHash = hash(rawToken);
let expiresAt = new Date(Date.now() + 86400000);
let requestStatus = "COMPLETED";
let jobs = [{ status: "COMPLETED" }];
let archivedCustomer = false;
let organizationStatus = "ACTIVE";
const matches = (row: object, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => {
  const actual = Reflect.get(row, key);
  return typeof value === "object" && value && "not" in value ? actual !== value.not : actual === value;
});
function grouped(rows: Array<{ status: FeedbackStatus; rating: number }>, where: Record<string, unknown>) {
  return (["NEW", "IN_REVIEW", "RESOLVED"] as const).flatMap((status) => {
    const matching = rows.filter((row) => matches(row, where) && row.status === status);
    return matching.length ? [{ status, _count: { _all: matching.length }, _sum: { rating: matching.reduce((sum, row) => sum + row.rating, 0) } }] : [];
  });
}
const invitationRow = () => ({
  id: "invite-a", organizationId: "org-a", serviceRequestId: "request-a", tokenHash: invitationHash, expiresAt,
  organization: { name: "Business A", status: organizationStatus },
  serviceRequest: { status: requestStatus, customer: { deletedAt: archivedCustomer ? now() : null }, jobs },
  feedback: responses[0] ?? null,
});
const db = {
  productFeedback: {
    groupBy: jest.fn(async ({ where }: { where: Record<string, unknown> }) => grouped(products, where)),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => products.find((row) => matches(row, where)) ?? null),
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => products.find((row) => row.id === where.id) ?? null),
    create: jest.fn(async ({ data }: { data: Partial<ProductFeedback> }) => { const row = productRow(data); products.push(row); return row; }),
    update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ProductFeedback> }) => { const row = products.find((row) => matches(row, where))!; Object.assign(row, data); return row; }),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => products.filter((row) => matches(row, where)).length),
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => products.filter((row) => matches(row, where)).map((row) => ({ ...row, organization: { name: row.organizationId } }))),
  },
  customerFeedback: {
    groupBy: jest.fn(async ({ where }: { where: Record<string, unknown> }) => grouped(responses, where)),
    create: jest.fn(async ({ data }: { data: Partial<CustomerFeedback> }) => { const row = customerRow(data); responses.push(row); return row; }),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => responses.find((row) => matches(row, where)) ?? null),
    update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<CustomerFeedback> }) => { const row = responses.find((row) => matches(row, where))!; Object.assign(row, data); return row; }),
    count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => responses.filter((row) => matches(row, where)).length),
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => responses.filter((row) => matches(row, where)).map((row) => ({ ...row, invitation: { serviceRequest: { referenceNumber: "SR-001" } } }))),
  },
  feedbackInvitation: {
    findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => where.tokenHash === invitationHash ? invitationRow() : null),
    findFirst: jest.fn(async () => ({ feedback: responses[0] ?? null })),
    upsert: jest.fn(async ({ create }: { create: { tokenHash: string } }) => { invitationHash = create.tokenHash; return { id: "invite-a" }; }),
  },
  serviceRequest: {
    findFirst: jest.fn(async ({ where }: { where: { organizationId: string } }) => where.organizationId === "org-a" && !archivedCustomer ? { id: "request-a", status: requestStatus, jobs } : null),
  },
  auditLog: { create: jest.fn(async ({ data }: { data: unknown }) => { if (failAudit) throw new Error("Audit failed"); auditRows.push(data); return {}; }) },
};
const prisma = { ...db, $transaction: async <T>(work: (db: typeof db) => Promise<T>) => {
  const before = structuredClone({ products, responses, auditRows, invitationHash });
  try { return await work(db); } catch (error) { ({ products, responses, auditRows, invitationHash } = before); throw error; }
} };
const platformGuard = jest.fn(async () => {
  if (requestContext.getValue("userId") !== "operator" || requestContext.getValue("organizationId")) throw new Error("Platform administration is required");
});
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: { FEEDBACK_INVITATION_DAYS: 30 } }));
jest.unstable_mockModule("@/modules/role/tenant-access-policy.js", () => ({ requirePlatformAuthority: platformGuard }));
const { requestContext } = await import("@/lib/requestContext.js");
const { feedbackService: service } = await import("@/modules/feedback/feedback.service.js");
const { productInput, publicSubmitInput, listInput, reviewInput } = await import("@/modules/feedback/feedback.schema.js");
const input = productInput.parse({ body: { rating: 4, comment: "Helpful workflow", submissionKey: productRow().submissionKey } }).body;
const publicInput = publicSubmitInput.parse({ body: { token: rawToken, rating: 4, comment: "Helpful workflow" } }).body;
const query = listInput.parse({ query: {} }).query;
const asTenant = <T>(work: () => Promise<T>, organizationId = "org-a", userId = "user-a") => requestContext.run({ requestId: "feedback-test", organizationId, userId }, work);
const asOperator = <T>(work: () => Promise<T>) => requestContext.run({ requestId: "feedback-test", userId: "operator" }, work);
beforeEach(() => {
  jest.clearAllMocks(); products = []; responses = []; auditRows = []; failAudit = false;
  invitationHash = hash(rawToken); expiresAt = new Date(Date.now() + 86400000);
  requestStatus = "COMPLETED"; jobs = [{ status: "COMPLETED" }]; archivedCustomer = false; organizationStatus = "ACTIVE";
});

test("product feedback is private by default and retries create one record/audit", async () => {
  await asTenant(() => service.submitProduct(input)); await asTenant(() => service.submitProduct(input));
  expect(products).toHaveLength(1); expect(auditRows).toHaveLength(1);
  expect(products[0]).toMatchObject({ organizationId: "org-a", authorId: "user-a", consentGrantedAt: null, testimonialApprovedAt: null });
  expect(JSON.stringify(auditRows)).not.toContain(input.comment);
  await expect(asTenant(() => service.submitProduct({ ...input, comment: "Different" }))).rejects.toMatchObject({ statusCode: 409 });
});
test("own submissions and withdrawal cannot cross tenants or authors", async () => {
  products = [productRow({ consentGrantedAt: now() }), productRow({ id: "foreign", organizationId: "org-b", authorId: "user-b" })];
  expect((await asTenant(() => service.mine(query))).feedback.map((row) => row.id)).toEqual(["product-a"]);
  await expect(asTenant(() => service.withdrawProduct("foreign"))).rejects.toMatchObject({ statusCode: 404 });
  await expect(asTenant(() => service.withdrawProduct("product-a"), "org-a", "another-author")).rejects.toMatchObject({ statusCode: 404 });
});
test("platform listing and review require explicit platform authority", async () => {
  await expect(asTenant(() => service.listProduct(query))).rejects.toThrow("Platform administration");
  await expect(asTenant(() => service.reviewProduct("product-a", { status: "RESOLVED" }))).rejects.toThrow("Platform administration");
  await asOperator(() => service.listProduct(query)); expect(platformGuard).toHaveBeenCalledTimes(3);
});
test("testimonial approval requires consent and withdrawal clears approval permanently", async () => {
  products = [productRow()];
  await expect(asOperator(() => service.reviewProduct("product-a", { testimonialApproved: true }))).rejects.toMatchObject({ statusCode: 409 });
  products[0]!.consentGrantedAt = now();
  await asOperator(() => service.reviewProduct("product-a", { testimonialApproved: true, status: "IN_REVIEW" }));
  expect(products[0]!.testimonialApprovedAt).toBeInstanceOf(Date);
  await asTenant(() => service.withdrawProduct("product-a"));
  expect(products[0]).toMatchObject({ testimonialApprovedAt: null, consentWithdrawnAt: expect.any(Date) });
  await expect(asOperator(() => service.reviewProduct("product-a", { testimonialApproved: true }))).rejects.toMatchObject({ statusCode: 409 });
  const count = auditRows.length; await asTenant(() => service.withdrawProduct("product-a")); expect(auditRows).toHaveLength(count);
});
test("customer inbox and review enforce trusted tenant ownership", async () => {
  responses = [customerRow(), customerRow({ id: "foreign", organizationId: "org-b" })];
  expect((await asTenant(() => service.listCustomer(query))).feedback.map((row) => row.id)).toEqual(["customer-feedback-a"]);
  await expect(asTenant(() => service.reviewCustomer("foreign", { status: "RESOLVED" }))).rejects.toMatchObject({ statusCode: 404 });
  await asTenant(() => service.reviewCustomer("customer-feedback-a", { status: "RESOLVED" }));
  expect(responses[0]!.status).toBe("RESOLVED"); expect(responses[1]!.status).toBe("NEW");
});
test.each(["PENDING", "IN_PROGRESS", "CANCELLED"])("does not invite feedback for a %s request", async (status) => {
  requestStatus = status; await expect(asTenant(() => service.createInvitation("request-a"))).rejects.toMatchObject({ statusCode: 409 });
  expect(db.feedbackInvitation.upsert).not.toHaveBeenCalled();
});
test("invitation guards archived customers, foreign requests, unfinished jobs and existing responses", async () => {
  await expect(asTenant(() => service.createInvitation("request-a"), "org-b")).rejects.toMatchObject({ statusCode: 404 });
  archivedCustomer = true; await expect(asTenant(() => service.createInvitation("request-a"))).rejects.toMatchObject({ statusCode: 404 });
  archivedCustomer = false; jobs = []; await expect(asTenant(() => service.createInvitation("request-a"))).rejects.toMatchObject({ statusCode: 409 });
  jobs = [{ status: "IN_PROGRESS" }]; await expect(asTenant(() => service.createInvitation("request-a"))).rejects.toMatchObject({ statusCode: 409 });
  jobs = [{ status: "COMPLETED" }]; responses = [customerRow()]; await expect(asTenant(() => service.createInvitation("request-a"))).rejects.toMatchObject({ statusCode: 409 });
});
test("invitation stores a hash, returns a 256-bit token and rotates previous unanswered links", async () => {
  const link = await asTenant(() => service.createInvitation("request-a"));
  expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(invitationHash).toBe(hash(link.token));
  expect(link.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
  expect(JSON.stringify(auditRows)).not.toContain(link.token);
  await expect(service.publicContext(rawToken)).rejects.toMatchObject({ statusCode: 404 });
  expect(await service.publicContext(link.token)).toEqual({ businessName: "Business A", submitted: false, consentActive: false });
});
test("public response omits customer identity, service details and feedback text", async () => {
  responses = [customerRow({ consentGrantedAt: now() })];
  expect(await service.publicContext(rawToken)).toEqual({ businessName: "Business A", submitted: true, consentActive: true });
});
test.each(["expired", "inactive", "archived", "incomplete"])("public %s invitations cannot submit", async (reason) => {
  if (reason === "expired") expiresAt = new Date(0);
  if (reason === "inactive") organizationStatus = "SUSPENDED";
  if (reason === "archived") archivedCustomer = true;
  if (reason === "incomplete") requestStatus = "IN_PROGRESS";
  await expect(service.submitCustomer(publicInput)).rejects.toMatchObject({ statusCode: 404 });
  expect(responses).toHaveLength(0);
});
test("customer retries do not duplicate feedback or restore withdrawn consent", async () => {
  const optedIn = { ...publicInput, allowTestimonial: true, displayName: "Customer A" };
  await service.submitCustomer(optedIn); await service.submitCustomer(optedIn);
  expect(responses).toHaveLength(1); expect(auditRows).toHaveLength(1);
  expect(responses[0]).toMatchObject({ consentVersion: "2026-10-17", consentGrantedAt: expect.any(Date) });
  responses[0]!.testimonialApprovedAt = now(); expiresAt = new Date(0); organizationStatus = "SUSPENDED";
  await service.withdrawCustomer(rawToken);
  expect(responses[0]).toMatchObject({ testimonialApprovedAt: null, consentWithdrawnAt: expect.any(Date) });
  await service.submitCustomer(optedIn); expect((await service.publicContext(rawToken)).consentActive).toBe(false);
});
test("audit failures roll back submission, review, consent and invitation changes", async () => {
  failAudit = true;
  await expect(asTenant(() => service.submitProduct(input))).rejects.toThrow("Audit failed"); expect(products).toHaveLength(0);
  await expect(service.submitCustomer(publicInput)).rejects.toThrow("Audit failed"); expect(responses).toHaveLength(0);
  await expect(asTenant(() => service.createInvitation("request-a"))).rejects.toThrow("Audit failed"); expect(invitationHash).toBe(hash(rawToken));
  products = [productRow({ consentGrantedAt: now(), testimonialApprovedAt: now() })];
  await expect(asTenant(() => service.withdrawProduct("product-a"))).rejects.toThrow("Audit failed"); expect(products[0]!.consentWithdrawnAt).toBeNull();
  await expect(asOperator(() => service.reviewProduct("product-a", { status: "RESOLVED" }))).rejects.toThrow("Audit failed"); expect(products[0]!.status).toBe("NEW");
});
test("schema rejects mass assignment, invalid ratings, false boolean coercion and excess content", () => {
  for (const body of [{ ...input, rating: 0 }, { ...input, rating: 5.5 }, { ...input, organizationId: "foreign" }, { ...input, status: "RESOLVED" }, { ...input, allowTestimonial: "false" }, { ...input, allowTestimonial: true }, { ...input, comment: "x".repeat(2001) }]) expect(productInput.safeParse({ body }).success).toBe(false);
  expect(publicSubmitInput.safeParse({ body: { ...publicInput, token: "short" } }).success).toBe(false);
  expect(reviewInput.safeParse({ params: { id: "a" }, body: { comment: "edited" } }).success).toBe(false);
  expect(listInput.safeParse({ query: { pageSize: 101 } }).success).toBe(false);
});

test("customer statistics cover all tenant responses independently of list filters", async () => {
  responses = [
    customerRow({ rating: 5, status: "RESOLVED", consentGrantedAt: now(), testimonialApprovedAt: now() }),
    customerRow({ id: "second", invitationId: "invite-b", rating: 3, status: "IN_REVIEW" }),
    customerRow({ id: "third", invitationId: "invite-c", rating: 2, status: "NEW", consentGrantedAt: now(), consentWithdrawnAt: now(), testimonialApprovedAt: now() }),
    customerRow({ id: "foreign", invitationId: "invite-d", organizationId: "org-b", rating: 5 }),
  ];
  const result = await asTenant(() => service.listCustomer({ ...query, status: "RESOLVED", testimonials: "ready" }));
  expect(result.feedback.map((row) => row.id)).toEqual(["customer-feedback-a"]);
  expect(result.stats).toEqual({ total: 3, averageRating: 3.3, byStatus: { NEW: 1, IN_REVIEW: 1, RESOLVED: 1 }, approvedTestimonials: 1 });
  await asTenant(() => service.reviewCustomer("customer-feedback-a", { testimonialApproved: false }));
  expect((await asTenant(() => service.listCustomer(query))).stats.approvedTestimonials).toBe(0);
});
test("product statistics respect author scope and platform authority", async () => {
  products = [
    productRow({ rating: 5, consentGrantedAt: now(), testimonialApprovedAt: now() }),
    productRow({ id: "second", submissionKey: "22345678-1234-4234-8234-123456789012", rating: 2, status: "RESOLVED" }),
    productRow({ id: "colleague", authorId: "colleague", rating: 1, status: "IN_REVIEW" }),
    productRow({ id: "foreign", authorId: "user-b", organizationId: "org-b", rating: 4 }),
  ];
  const own = await asTenant(() => service.mine({ ...query, status: "RESOLVED" }));
  expect(own.stats).toEqual({ total: 2, averageRating: 3.5, byStatus: { NEW: 1, IN_REVIEW: 0, RESOLVED: 1 }, approvedTestimonials: 1 });
  const all = await asOperator(() => service.listProduct({ ...query, status: "RESOLVED", pageSize: 1 }));
  expect(all.stats).toEqual({ total: 4, averageRating: 3, byStatus: { NEW: 2, IN_REVIEW: 1, RESOLVED: 1 }, approvedTestimonials: 1 });
  await asTenant(() => service.withdrawProduct("product-a"));
  expect((await asTenant(() => service.mine(query))).stats.approvedTestimonials).toBe(0);
  await expect(asTenant(() => service.listProduct(query))).rejects.toThrow("Platform administration");
});
test("empty statistics have zero counts and no invented average", async () => {
  const empty = { total: 0, averageRating: null, byStatus: { NEW: 0, IN_REVIEW: 0, RESOLVED: 0 }, approvedTestimonials: 0 };
  expect((await asTenant(() => service.mine(query))).stats).toEqual(empty);
  expect((await asTenant(() => service.listCustomer(query))).stats).toEqual(empty);
  expect((await asOperator(() => service.listProduct(query))).stats).toEqual(empty);
});
