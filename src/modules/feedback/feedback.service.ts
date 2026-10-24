import { createHash, randomBytes } from "node:crypto";
import type { Prisma, FeedbackStatus } from "@/generated/prisma/client";
import { env } from "@/config/env";
import { requestContext } from "@/lib/requestContext";
import { assertDemoActionAllowed } from "@/lib/demo-guard";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy";
import { AppError } from "@/utils/AppError";
import { pagination, tenantOrganization, tenantTransaction } from "@/utils/tenant-transaction";
import { CONSENT_VERSION, type ProductInput, type PublicSubmitInput, type FeedbackList, type ReviewInput } from "./feedback.schema";

const fields = {
  id: true, rating: true, comment: true, displayName: true, status: true,
  consentGrantedAt: true, consentVersion: true, consentWithdrawnAt: true,
  testimonialApprovedAt: true, createdAt: true,
} as const;
const productSelect = { ...fields, organization: { select: { name: true } } } satisfies Prisma.ProductFeedbackSelect;
const customerSelect = {
  ...fields, invitation: { select: { serviceRequest: { select: { referenceNumber: true } } } },
} satisfies Prisma.CustomerFeedbackSelect;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
function author() {
  const userId = requestContext.getValue("userId");
  if (!userId) throw new AppError(401, "Authentication is required");
  return { organizationId: tenantOrganization(), authorId: userId };
}
type Consent = { consentGrantedAt: Date | null; consentWithdrawnAt: Date | null };
function hasConsent(row: Consent) { return !!row.consentGrantedAt && !row.consentWithdrawnAt; }
function content(input: ProductInput | PublicSubmitInput) {
  return {
    rating: input.rating, comment: input.comment,
    displayName: input.allowTestimonial ? input.displayName : null,
    consentGrantedAt: input.allowTestimonial ? new Date() : null,
    consentVersion: input.allowTestimonial ? CONSENT_VERSION : null,
  };
}
function checkReplay(row: { rating: number; comment: string; displayName: string | null; consentGrantedAt: Date | null }, input: ProductInput | PublicSubmitInput) {
  if (row.rating !== input.rating || row.comment !== input.comment ||
    row.displayName !== (input.allowTestimonial ? input.displayName : null) ||
    !!row.consentGrantedAt !== input.allowTestimonial) {
    throw new AppError(409, "Feedback has already been submitted. Refresh to view its status.");
  }
}
const approvedTestimonial = {
  testimonialApprovedAt: { not: null }, consentGrantedAt: { not: null }, consentWithdrawnAt: null,
};
function filters(query: FeedbackList) {
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.testimonials === "ready" ? approvedTestimonial : {}),
  };
}
type StatusAggregate = { status: FeedbackStatus; _count: { _all: number }; _sum: { rating: number | null } };
function summarize(groups: StatusAggregate[], approvedTestimonials: number) {
  const byStatus = { NEW: 0, IN_REVIEW: 0, RESOLVED: 0 };
  let total = 0;
  let ratingSum = 0;
  for (const group of groups) {
    byStatus[group.status] = group._count._all;
    total += group._count._all;
    ratingSum += group._sum.rating ?? 0;
  }
  return { total, averageRating: total ? Math.round(ratingSum / total * 10) / 10 : null, byStatus, approvedTestimonials };
}
// Summaries use the viewer's full scope, independently of list filters or pages.
async function productStats(db: Prisma.TransactionClient, where: Prisma.ProductFeedbackWhereInput) {
  const [groups, approved] = await Promise.all([
    db.productFeedback.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { rating: true } }),
    db.productFeedback.count({ where: { ...where, ...approvedTestimonial } }),
  ]);
  return summarize(groups, approved);
}
async function customerStats(db: Prisma.TransactionClient, organizationId: string) {
  const [groups, approved] = await Promise.all([
    db.customerFeedback.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true }, _sum: { rating: true } }),
    db.customerFeedback.count({ where: { organizationId, ...approvedTestimonial } }),
  ]);
  return summarize(groups, approved);
}
async function audit(db: Prisma.TransactionClient, organizationId: string, scope: "TENANT" | "PLATFORM", action: string, entity: string, entityId: string, after?: Prisma.InputJsonValue) {
  const ctx = requestContext.get();
  await db.auditLog.create({ data: {
    organizationId, scope, actorId: ctx?.userId ?? null,
    actorType: ctx?.userId ? "USER" : "CUSTOMER", action, entity, entityId,
    metadata: { ...(after === undefined ? {} : { after }) },
    ipAddress: ctx?.ip ?? null, userAgent: ctx?.userAgent?.slice(0, 191) ?? null,
    requestId: ctx?.requestId?.slice(0, 191) ?? null,
  } });
}
function reviewData(row: Consent, input: ReviewInput) {
  if (input.testimonialApproved === true && !hasConsent(row)) {
    throw new AppError(409, "Publication requires the submitter's active consent");
  }
  return {
    ...(input.status ? { status: input.status } : {}),
    ...(input.testimonialApproved === undefined ? {} : { testimonialApprovedAt: input.testimonialApproved ? new Date() : null }),
  };
}
const invalidLink = () => new AppError(404, "This feedback link is unavailable or has expired");
async function invitation(db: Prisma.TransactionClient, token: string) {
  const row = await db.feedbackInvitation.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: {
      organization: { select: { name: true, status: true, isDemo: true } },
      serviceRequest: { select: {
        status: true, customer: { select: { deletedAt: true } }, jobs: { select: { status: true } },
      } },
      feedback: true,
    },
  });
  if (!row || row.organization.isDemo) throw invalidLink();
  return row;
}
type Invitation = Awaited<ReturnType<typeof invitation>>;
function available(row: Invitation) {
  const request = row.serviceRequest;
  if (row.organization.status !== "ACTIVE" || row.expiresAt <= new Date() ||
      request.status !== "COMPLETED" || request.customer.deletedAt ||
      !request.jobs.length || request.jobs.some((job) => job.status !== "COMPLETED")) throw invalidLink();
}

export const feedbackService = {
  async submitProduct(input: ProductInput) {
    const actor = author();
    return tenantTransaction(async (db) => {
      await assertDemoActionAllowed(db, actor.organizationId, "submit product feedback");
      const previous = await db.productFeedback.findFirst({ where: { ...actor, submissionKey: input.submissionKey }, select: fields });
      if (previous) { checkReplay(previous, input); return previous; }
      const row = await db.productFeedback.create({ data: { ...actor, submissionKey: input.submissionKey, ...content(input) }, select: fields });
      await audit(db, actor.organizationId, "PLATFORM", "feedback.product.submitted", "ProductFeedback", row.id, { consentVersion: input.allowTestimonial ? CONSENT_VERSION : null });
      return row;
    });
  },
  async mine(query: FeedbackList) {
    const actor = author();
    return tenantTransaction(async (db) => {
      const where = { ...actor, ...filters(query) };
      const meta = pagination(query.page, query.pageSize, await db.productFeedback.count({ where }));
      const feedback = await db.productFeedback.findMany({ where, select: productSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (meta.page - 1) * meta.pageSize, take: meta.pageSize });
      return { feedback: feedback.map(({ organization, ...row }) => ({ ...row, source: organization.name })), pagination: meta, stats: await productStats(db, actor) };
    });
  },
  async listProduct(query: FeedbackList) {
    return tenantTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const where = filters(query);
      const meta = pagination(query.page, query.pageSize, await db.productFeedback.count({ where }));
      const feedback = await db.productFeedback.findMany({ where, select: productSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (meta.page - 1) * meta.pageSize, take: meta.pageSize });
      return { feedback: feedback.map(({ organization, ...row }) => ({ ...row, source: organization.name })), pagination: meta, stats: await productStats(db, {}) };
    });
  },
  async listCustomer(query: FeedbackList) {
    const organizationId = tenantOrganization();
    return tenantTransaction(async (db) => {
      const where = { organizationId, ...filters(query) };
      const meta = pagination(query.page, query.pageSize, await db.customerFeedback.count({ where }));
      const feedback = await db.customerFeedback.findMany({ where, select: customerSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (meta.page - 1) * meta.pageSize, take: meta.pageSize });
      return { feedback: feedback.map(({ invitation, ...row }) => ({ ...row, source: invitation.serviceRequest.referenceNumber })), pagination: meta, stats: await customerStats(db, organizationId) };
    });
  },
  async reviewProduct(id: string, input: ReviewInput) {
    return tenantTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const row = await db.productFeedback.findUnique({ where: { id } });
      if (!row) throw new AppError(404, "Feedback not found");
      if (input.testimonialApproved) await assertDemoActionAllowed(db, row.organizationId, "publish testimonials");
      const result = await db.productFeedback.update({ where: { id }, data: reviewData(row, input), select: fields });
      await audit(db, row.organizationId, "PLATFORM", "feedback.product.reviewed", "ProductFeedback", id, input);
      return result;
    });
  },
  async reviewCustomer(id: string, input: ReviewInput) {
    const organizationId = tenantOrganization();
    return tenantTransaction(async (db) => {
      const row = await db.customerFeedback.findFirst({ where: { id, organizationId } });
      if (!row) throw new AppError(404, "Feedback not found");
      if (input.testimonialApproved) await assertDemoActionAllowed(db, organizationId, "publish testimonials");
      const result = await db.customerFeedback.update({ where: { id, organizationId }, data: reviewData(row, input), select: fields });
      await audit(db, organizationId, "TENANT", "feedback.customer.reviewed", "CustomerFeedback", id, input);
      return result;
    });
  },
  async withdrawProduct(id: string) {
    const actor = author();
    return tenantTransaction(async (db) => {
      const row = await db.productFeedback.findFirst({ where: { id, ...actor } });
      if (!row) throw new AppError(404, "Feedback not found");
      if (!hasConsent(row)) return { withdrawn: true };
      await db.productFeedback.update({ where: { id, ...actor }, data: { consentWithdrawnAt: new Date(), testimonialApprovedAt: null } });
      await audit(db, actor.organizationId, "PLATFORM", "feedback.product.consent_withdrawn", "ProductFeedback", id);
      return { withdrawn: true };
    });
  },
  async createInvitation(serviceRequestId: string) {
    const organizationId = tenantOrganization();
    return tenantTransaction(async (db) => {
      await assertDemoActionAllowed(db, organizationId, "invite customers to submit feedback");
      const request = await db.serviceRequest.findFirst({ where: { id: serviceRequestId, organizationId, customer: { organizationId, deletedAt: null } }, select: { id: true, status: true, jobs: { where: { organizationId }, select: { status: true } } } });
      if (!request) throw new AppError(404, "Service request not found");
      if (request.status !== "COMPLETED" || !request.jobs.length || request.jobs.some((job) => job.status !== "COMPLETED")) {
        throw new AppError(409, "Complete the entire service request before inviting feedback");
      }
      const previous = await db.feedbackInvitation.findFirst({ where: { serviceRequestId, organizationId }, select: { feedback: { select: { id: true } } } });
      if (previous?.feedback) throw new AppError(409, "This request already has customer feedback");
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + env.FEEDBACK_INVITATION_DAYS * 86_400_000);
      const row = await db.feedbackInvitation.upsert({
        where: { serviceRequestId },
        create: { organizationId, serviceRequestId, tokenHash: tokenHash(token), expiresAt },
        update: { tokenHash: tokenHash(token), expiresAt },
        select: { id: true },
      });
      await audit(db, organizationId, "TENANT", "feedback.invitation.created", "FeedbackInvitation", row.id, { serviceRequestId, expiresAt: expiresAt.toISOString() });
      return { token, expiresAt };
    });
  },
  async publicContext(token: string) {
    return tenantTransaction(async (db) => {
      const row = await invitation(db, token);
      if (!row.feedback) available(row);
      // Previously submitted links expose only consent controls, even after expiry.
      return { businessName: row.organization.name, submitted: !!row.feedback, consentActive: !!row.feedback && hasConsent(row.feedback) };
    });
  },
  async submitCustomer(input: PublicSubmitInput) {
    return tenantTransaction(async (db) => {
      const row = await invitation(db, input.token);
      if (row.feedback) { checkReplay(row.feedback, input); return { submitted: true }; }
      available(row);
      const feedback = await db.customerFeedback.create({ data: { invitationId: row.id, organizationId: row.organizationId, ...content(input) }, select: { id: true } });
      await audit(db, row.organizationId, "TENANT", "feedback.customer.submitted", "CustomerFeedback", feedback.id, { consentVersion: input.allowTestimonial ? CONSENT_VERSION : null });
      return { submitted: true };
    });
  },
  async withdrawCustomer(token: string) {
    return tenantTransaction(async (db) => {
      const row = await invitation(db, token);
      if (!row.feedback) throw invalidLink();
      if (!hasConsent(row.feedback)) return { withdrawn: true };
      await db.customerFeedback.update({ where: { id: row.feedback.id, organizationId: row.organizationId }, data: { consentWithdrawnAt: new Date(), testimonialApprovedAt: null } });
      await audit(db, row.organizationId, "TENANT", "feedback.customer.consent_withdrawn", "CustomerFeedback", row.feedback.id);
      return { withdrawn: true };
    });
  },
};
