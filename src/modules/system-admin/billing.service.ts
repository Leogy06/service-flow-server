import { Prisma, type Subscription } from "@/generated/prisma/client.js";
import { prisma } from "@/lib/prisma.js";
import { requestContext } from "@/lib/requestContext.js";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
import { AppError } from "@/utils/AppError.js";
import { billingPeriod, assertExactPayment, assertManualSubscriptionTransition, trialPeriod } from "./billing-policy.js";
import { countActiveSeats } from "./entitlement.js";
import { lockOrganization, platformTransaction, recordPlatformAudit } from "./platform-audit.js";
import type { PlanListQuery, SubscriptionListQuery, PaymentListQuery, CreatePlanInput, UpdatePlanInput, AssignSubscriptionInput,
  ChangePlanInput, ChangeStatusInput, RecordPaymentInput, ReviewPaymentInput, RefundPaymentInput, StartTrialInput } from "./billing.schema.js";

const organizationSelect = { id: true, name: true, slug: true, status: true } satisfies Prisma.OrganizationSelect;
const subscriptionInclude = { plan: true, organization: { select: organizationSelect }, history: { orderBy: { createdAt: "desc" }, take: 20 } } satisfies Prisma.SubscriptionInclude;
const paymentInclude = { organization: { select: organizationSelect }, subscription: { select: { id: true, status: true, startsAt: true, expiresAt: true, price: true, billingInterval: true, currency: true, plan: true } }, refund: true } satisfies Prisma.SubscriptionPaymentInclude;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function snapshot(subscription: Subscription) {
  return { id: subscription.id, planId: subscription.planId, status: subscription.status,
    startsAt: subscription.startsAt?.toISOString() ?? null, expiresAt: subscription.expiresAt?.toISOString() ?? null,
    trialStartedAt: subscription.trialStartedAt?.toISOString() ?? null, trialExpiresAt: subscription.trialExpiresAt?.toISOString() ?? null,
    price: subscription.price.toString(), billingInterval: subscription.billingInterval, currency: subscription.currency,
    currentPeriodPaymentId: subscription.currentPeriodPaymentId, version: subscription.version };
}
function coverageRoot(after: Prisma.JsonValue | undefined): string | null {
  return after && typeof after === "object" && !Array.isArray(after) && typeof after.coverageRootPaymentId === "string" ? after.coverageRootPaymentId : null;
}
async function history(db: Prisma.TransactionClient, subscription: Subscription, kind: string, before: Prisma.InputJsonValue | null, reason: string, paymentId?: string, coverageRootPaymentId?: string) {
  await db.subscriptionHistory.create({ data: { subscriptionId: subscription.id, kind, reason,
    before: before ?? Prisma.JsonNull, after: { ...snapshot(subscription), ...(coverageRootPaymentId ? { coverageRootPaymentId } : {}) },
    actorId: requestContext.getValue("userId") ?? null, paymentId: paymentId ?? null } });
}
async function page<T>(query: { page: number; pageSize: number }, count: () => Promise<number>, fetch: (skip: number) => Promise<T[]>) {
  const total = await count();
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const currentPage = Math.min(query.page, totalPages);
  return { items: await fetch((currentPage - 1) * query.pageSize), pagination: { total, totalPages, page: currentPage, pageSize: query.pageSize,
    hasNextPage: currentPage < totalPages, hasPreviousPage: currentPage > 1 } };
}
async function subscriptionOrganization(id: string) {
  const result = await prisma.subscription.findUnique({ where: { id }, select: { organizationId: true } });
  if (!result) throw new AppError(404, "Subscription not found");
  return result.organizationId;
}
async function paymentOrganization(id: string) {
  const result = await prisma.subscriptionPayment.findUnique({ where: { id }, select: { organizationId: true } });
  if (!result) throw new AppError(404, "Payment not found");
  return result.organizationId;
}
async function requireSubscription(db: Prisma.TransactionClient, id: string) {
  const result = await db.subscription.findUnique({ where: { id }, include: { plan: true } });
  if (!result) throw new AppError(404, "Subscription not found");
  return result;
}
async function checkPlanSeats(db: Prisma.TransactionClient, organizationId: string, maxActiveUsers: number) {
  if (await countActiveSeats(db, organizationId) > maxActiveUsers) throw new AppError(409, "The selected plan cannot accommodate the organization's active users");
}

export const billingService = {
  async listPlans(query: PlanListQuery) {
    await requirePlatformAuthority();
    const where: Prisma.PlanWhereInput = { billingInterval: query.billingInterval, ...(query.status ? { isActive: query.status === "ACTIVE" } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search } }, { description: { contains: query.search } }] } : {}) };
    return prisma.$transaction((db) => page(query, () => db.plan.count({ where }), (skip) => db.plan.findMany({ where, skip, take: query.pageSize,
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }] })), { isolationLevel: "RepeatableRead" });
  },
  async listSubscriptions(query: SubscriptionListQuery) {
    await requirePlatformAuthority();
    const where: Prisma.SubscriptionWhereInput = { organizationId: query.organizationId, planId: query.planId, status: query.status,
      ...(query.search ? { OR: [{ organization: { name: { contains: query.search } } }, { organization: { slug: { contains: query.search } } }, { plan: { name: { contains: query.search } } }] } : {}) };
    return prisma.$transaction((db) => page(query, () => db.subscription.count({ where }), (skip) => db.subscription.findMany({ where, skip, take: query.pageSize,
      include: subscriptionInclude, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }] })), { isolationLevel: "RepeatableRead" });
  },
  async subscription(id: string) {
    await requirePlatformAuthority();
    const result = await prisma.subscription.findUnique({ where: { id }, include: { ...subscriptionInclude,
      history: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }, payments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { refund: true } } } });
    if (!result) throw new AppError(404, "Subscription not found");
    return result;
  },
  async listPayments(query: PaymentListQuery) {
    await requirePlatformAuthority();
    const where: Prisma.SubscriptionPaymentWhereInput = { organizationId: query.organizationId, subscriptionId: query.subscriptionId, status: query.status,
      ...(query.search ? { OR: [{ referenceNumber: { contains: query.search } }, { organization: { name: { contains: query.search } } }, { organization: { slug: { contains: query.search } } }] } : {}) };
    return prisma.$transaction((db) => page(query, () => db.subscriptionPayment.count({ where }), (skip) => db.subscriptionPayment.findMany({ where, skip, take: query.pageSize,
      include: paymentInclude, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }] })), { isolationLevel: "RepeatableRead" });
  },
  async payment(id: string) {
    await requirePlatformAuthority();
    const result = await prisma.subscriptionPayment.findUnique({ where: { id }, include: { ...paymentInclude, history: { take: 50, orderBy: { createdAt: "desc" } } } });
    if (!result) throw new AppError(404, "Payment not found");
    return result;
  },
  createPlan(input: CreatePlanInput) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const plan = await db.plan.create({ data: { name: input.name, description: input.description, price: new Prisma.Decimal(input.price), billingInterval: input.billingInterval, currency: input.currency,
        maxActiveUsers: input.maxActiveUsers, isActive: input.isActive } });
      await recordPlatformAudit(db, { action: "platform.plan.create", entity: "Plan", entityId: plan.id, after: json({ ...plan, reason: input.reason }) });
      return plan;
    });
  },
  updatePlan(id: string, input: UpdatePlanInput) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const before = await db.plan.findUnique({ where: { id } });
      if (!before) throw new AppError(404, "Plan not found");
      if (input.maxActiveUsers !== undefined && input.maxActiveUsers < before.maxActiveUsers) {
        const subscriptions = await db.subscription.findMany({ where: { planId: id }, select: { organizationId: true }, orderBy: { organizationId: "asc" }, take: 1001 });
        if (subscriptions.length > 1000) throw new AppError(409, "Use a replacement-plan rollout for seat reductions affecting more than 1,000 tenants");
        for (const subscription of subscriptions) {
          await lockOrganization(db, subscription.organizationId);
          await checkPlanSeats(db, subscription.organizationId, input.maxActiveUsers);
        }
      }
      const plan = await db.plan.update({ where: { id }, data: { name: input.name, description: input.description,
        price: input.price === undefined ? undefined : new Prisma.Decimal(input.price), billingInterval: input.billingInterval, currency: input.currency,
        maxActiveUsers: input.maxActiveUsers, isActive: input.isActive } });
      await recordPlatformAudit(db, { action: "platform.plan.update", entity: "Plan", entityId: id, before: json(before), after: json({ ...plan, reason: input.reason }) });
      return plan;
    });
  },
  assignSubscription(input: AssignSubscriptionInput) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      await lockOrganization(db, input.organizationId);
      const existing = await db.subscription.findUnique({ where: { organizationId: input.organizationId } });
      if (existing) throw new AppError(409, "Organization already has a subscription; use plan change or renewal");
      const planId = input.planId ?? (await db.platformSettings.findUnique({ where: { id: "singleton" }, select: { defaultPlanId: true } }))?.defaultPlanId;
      if (!planId) throw new AppError(409, "Select a plan or configure an active subscription default");
      const plan = await db.plan.findUnique({ where: { id: planId } });
      if (!plan?.isActive) throw new AppError(409, "Plan is unavailable for new assignment");
      await checkPlanSeats(db, input.organizationId, plan.maxActiveUsers);
      const trial = input.startTrial ? trialPeriod() : null;
      const subscription = await db.subscription.create({ data: { organizationId: input.organizationId, planId: plan.id, status: trial ? "TRIALING" : "PENDING",
        ...(trial ? { ...trial, startsAt: trial.trialStartedAt, expiresAt: trial.trialExpiresAt } : {}),
        price: plan.price, billingInterval: plan.billingInterval, currency: plan.currency } });
      await db.organization.update({ where: { id: input.organizationId }, data: { billingEnabled: true } });
      await history(db, subscription, trial ? "TRIAL_STARTED" : "ASSIGNED", null, input.reason);
      await recordPlatformAudit(db, { action: trial ? "platform.subscription.trial" : "platform.subscription.assign", entity: "Subscription", entityId: subscription.id, organizationId: input.organizationId, after: { ...snapshot(subscription), reason: input.reason } });
      return subscription;
    });
  },
  async startTrial(id: string, input: StartTrialInput) {
    await requirePlatformAuthority();
    const organizationId = await subscriptionOrganization(id);
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      await lockOrganization(db, organizationId);
      const before = await requireSubscription(db, id);
      if (before.trialStartedAt || before.status !== "PENDING" || before.currentPeriodPaymentId) {
        throw new AppError(409, "A free trial is available once per organization, before paid activation");
      }
      if (!before.plan.isActive) throw new AppError(409, "Select an available plan before starting a trial");
      await checkPlanSeats(db, organizationId, before.plan.maxActiveUsers);
      const trial = trialPeriod();
      const subscription = await db.subscription.update({ where: { id }, data: { status: "TRIALING", ...trial,
        startsAt: trial.trialStartedAt, expiresAt: trial.trialExpiresAt, price: before.plan.price,
        billingInterval: before.plan.billingInterval, currency: before.plan.currency, version: { increment: 1 } } });
      await db.organization.update({ where: { id: organizationId }, data: { billingEnabled: true } });
      await history(db, subscription, "TRIAL_STARTED", snapshot(before), input.reason);
      await recordPlatformAudit(db, { action: "platform.subscription.trial", entity: "Subscription", entityId: id, organizationId,
        before: snapshot(before), after: { ...snapshot(subscription), reason: input.reason } });
      return subscription;
    });
  },
  async changePlan(id: string, input: ChangePlanInput) {
    await requirePlatformAuthority();
    const organizationId = await subscriptionOrganization(id);
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      await lockOrganization(db, organizationId);
      const before = await requireSubscription(db, id);
      const plan = await db.plan.findUnique({ where: { id: input.planId } });
      if (!plan?.isActive) throw new AppError(409, "Plan is unavailable for new assignment");
      await checkPlanSeats(db, organizationId, plan.maxActiveUsers);
      if (before.planId === plan.id) return before;
      const subscription = await db.subscription.update({ where: { id }, data: { planId: plan.id, version: { increment: 1 } } });
      await history(db, subscription, "PLAN_CHANGED", snapshot(before), input.reason);
      await recordPlatformAudit(db, { action: "platform.subscription.plan", entity: "Subscription", entityId: id, organizationId, before: snapshot(before), after: { ...snapshot(subscription), reason: input.reason } });
      return subscription;
    });
  },
  async changeStatus(id: string, input: ChangeStatusInput) {
    await requirePlatformAuthority();
    const organizationId = await subscriptionOrganization(id);
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      await lockOrganization(db, organizationId);
      const before = await requireSubscription(db, id);
      assertManualSubscriptionTransition(before.status, input.status);
      const subscription = await db.subscription.update({ where: { id }, data: { status: input.status, version: { increment: 1 } } });
      await history(db, subscription, "STATUS_CHANGED", snapshot(before), input.reason);
      await recordPlatformAudit(db, { action: "platform.subscription.status", entity: "Subscription", entityId: id, organizationId, before: snapshot(before), after: { ...snapshot(subscription), reason: input.reason } });
      return subscription;
    });
  },
  async recordPayment(input: RecordPaymentInput) {
    await requirePlatformAuthority();
    const organizationId = await subscriptionOrganization(input.subscriptionId);
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      await lockOrganization(db, organizationId);
      const subscription = await requireSubscription(db, input.subscriptionId);
      const existing = await db.subscriptionPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.subscriptionId !== input.subscriptionId || existing.currency !== input.currency || !new Prisma.Decimal(existing.amount).equals(input.amount) ||
          existing.paymentMethod !== input.paymentMethod || existing.referenceNumber !== input.referenceNumber || existing.paidAt.getTime() !== input.paidAt.getTime()) {
          throw new AppError(409, "Idempotency key was already used for a different payment request");
        }
        return existing;
      }
      assertExactPayment(input.amount, input.currency, subscription.plan.price, subscription.plan.currency);
      if (await db.subscriptionPayment.findUnique({ where: { referenceNumber: input.referenceNumber } })) throw new AppError(409, "Payment reference already exists");
      const payment = await db.subscriptionPayment.create({ data: { organizationId, subscriptionId: input.subscriptionId, amount: new Prisma.Decimal(input.amount), currency: input.currency,
        paymentMethod: input.paymentMethod, referenceNumber: input.referenceNumber, idempotencyKey: input.idempotencyKey, paidAt: input.paidAt, status: "PENDING" } });
      await recordPlatformAudit(db, { action: "platform.payment.record", entity: "SubscriptionPayment", entityId: payment.id, organizationId, after: json({ ...payment, reason: input.reason }) });
      return payment;
    });
  },
  async reviewPayment(id: string, input: ReviewPaymentInput) {
    await requirePlatformAuthority();
    const organizationId = await paymentOrganization(id);
    return platformTransaction(async (db) => {
      const actor = await requirePlatformAuthority(db);
      await lockOrganization(db, organizationId);
      const before = await db.subscriptionPayment.findUnique({ where: { id } });
      if (!before) throw new AppError(404, "Payment not found");
      if (before.status === input.decision) return before;
      if (!["PENDING", "UNDER_REVIEW"].includes(before.status)) throw new AppError(409, "Payment is already finalized");
      const now = new Date();
      const subscription = await requireSubscription(db, before.subscriptionId);
      let period: ReturnType<typeof billingPeriod> | undefined;
      const continuous = ["ACTIVE", "PAST_DUE"].includes(subscription.status) && subscription.startsAt && subscription.startsAt <= now && subscription.expiresAt && subscription.expiresAt > now;
      if (input.decision === "PAID") {
        assertExactPayment(before.amount, before.currency, subscription.plan.price, subscription.plan.currency);
        await checkPlanSeats(db, organizationId, subscription.plan.maxActiveUsers);
        if (["ACTIVE", "PAST_DUE"].includes(subscription.status) && subscription.startsAt && subscription.startsAt > now && subscription.expiresAt && subscription.expiresAt > now) {
          throw new AppError(409, "Resolve the refunded coverage gap before recording another renewal");
        }
        period = billingPeriod(now, continuous ? subscription.expiresAt : null, subscription.plan.billingInterval);
      }
      const payment = await db.subscriptionPayment.update({ where: { id }, data: { status: input.decision, evidence: input.evidence, verificationReason: input.reason,
        verifiedBy: actor.id, verifiedAt: now, billingInterval: input.decision === "PAID" ? subscription.plan.billingInterval : undefined, periodStartsAt: period?.startsAt, periodExpiresAt: period?.expiresAt } });
      if (period) {
        const previousHistory = continuous && subscription.currentPeriodPaymentId
          ? await db.subscriptionHistory.findUnique({ where: { paymentId: subscription.currentPeriodPaymentId } }) : null;
        // A fresh paid period after cancellation begins a new coverage chain.
        // Old paid-but-canceled intervals cannot become entitled again on refund.
        const coverageRootPaymentId = continuous ? coverageRoot(previousHistory?.after) ?? subscription.currentPeriodPaymentId ?? id : id;
        const renewed = await db.subscription.update({ where: { id: subscription.id }, data: { status: "ACTIVE",
          startsAt: continuous ? subscription.startsAt : now,
          expiresAt: period.expiresAt, price: subscription.plan.price, billingInterval: subscription.plan.billingInterval, currency: subscription.plan.currency, currentPeriodPaymentId: id, version: { increment: 1 } } });
        await history(db, renewed, "RENEWED", snapshot(subscription), input.reason, id, coverageRootPaymentId);
      }
      await recordPlatformAudit(db, { action: input.decision === "PAID" ? "platform.payment.verify" : "platform.payment.review", entity: "SubscriptionPayment", entityId: id,
        organizationId, before: json(before), after: json({ ...payment, reason: input.reason }) });
      return payment;
    });
  },
  async refundPayment(id: string, input: RefundPaymentInput) {
    await requirePlatformAuthority();
    const organizationId = await paymentOrganization(id);
    return platformTransaction(async (db) => {
      const actor = await requirePlatformAuthority(db);
      await lockOrganization(db, organizationId);
      const existing = await db.subscriptionRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (existing.paymentId !== id || existing.reason !== input.reason || existing.evidence !== input.evidence) throw new AppError(409, "Idempotency key was already used for a different refund request");
        return existing;
      }
      const payment = await db.subscriptionPayment.findUnique({ where: { id } });
      if (!payment) throw new AppError(404, "Payment not found");
      if (payment.status !== "PAID") throw new AppError(409, "Only a verified, unrefunded payment can be refunded");
      const before = await requireSubscription(db, payment.subscriptionId);
      const refund = await db.subscriptionRefund.create({ data: { paymentId: id, amount: payment.amount, currency: payment.currency,
        idempotencyKey: input.idempotencyKey, reason: input.reason, evidence: input.evidence, actorId: actor.id } });
      await db.subscriptionPayment.update({ where: { id }, data: { status: "REFUNDED" } });
      const now = new Date();
      let after: Subscription = before;
      // An ended historic period cannot change the present subscription. Current
      // and future refunds rebuild continuous coverage from immutable paid intervals.
      if (before.currentPeriodPaymentId === id || (payment.periodExpiresAt && payment.periodExpiresAt > now)) {
        const currentHistory = before.currentPeriodPaymentId ? await db.subscriptionHistory.findUnique({ where: { paymentId: before.currentPeriodPaymentId } }) : null;
        const rootId = coverageRoot(currentHistory?.after) ?? before.currentPeriodPaymentId;
        const renewals = await db.subscriptionHistory.findMany({ where: { subscriptionId: before.id, kind: "RENEWED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1001 });
        if (renewals.length > 1000) throw new AppError(409, "This refund requires a bounded billing-history review");
        const eligiblePaymentIds = renewals.filter((item) => coverageRoot(item.after) === rootId).flatMap((item) => item.paymentId ? [item.paymentId] : []);
        if (rootId) eligiblePaymentIds.push(rootId);
        const remaining = await db.subscriptionPayment.findMany({ where: { subscriptionId: before.id, id: { in: eligiblePaymentIds }, status: "PAID", periodExpiresAt: { gt: now } },
          orderBy: [{ periodStartsAt: "asc" }, { id: "asc" }], take: 1001 });
        if (remaining.length > 1000) throw new AppError(409, "This refund requires a bounded billing-history review");
        const first = remaining.find((item) => item.periodStartsAt && item.periodExpiresAt);
        let last = first;
        if (first) {
          for (const item of remaining) {
            if (!item.periodStartsAt || !item.periodExpiresAt || !last?.periodExpiresAt) continue;
            if (item.periodStartsAt > last.periodExpiresAt) break;
            if (item.periodExpiresAt > last.periodExpiresAt) last = item;
          }
        }
        after = await db.subscription.update({ where: { id: before.id }, data: first && last ? {
          startsAt: first.periodStartsAt, expiresAt: last.periodExpiresAt, currentPeriodPaymentId: last.id,
          price: last.amount, billingInterval: last.billingInterval, currency: last.currency, status: before.status === "CANCELED" ? "CANCELED" : before.status === "PAST_DUE" ? "PAST_DUE" : "ACTIVE", version: { increment: 1 },
        } : { status: "CANCELED", expiresAt: now, currentPeriodPaymentId: null, version: { increment: 1 } } });
      }
      await history(db, after, "REFUNDED", snapshot(before), input.reason);
      await recordPlatformAudit(db, { action: "platform.payment.refund", entity: "SubscriptionPayment", entityId: id, organizationId, before: json(payment),
        after: json({ refund, subscription: snapshot(after), reason: input.reason }) });
      return refund;
    });
  },
};
