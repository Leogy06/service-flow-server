import { cachedRead, invalidating } from "@/utils/module-cache";
import type {
  Prisma,
  SubscriptionUpgradeRequest,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/requestContext";
import { loadAuthorization } from "@/modules/auth/authorization";
import {
  isTenantAdminName,
  requirePlatformAuthority,
} from "@/modules/role/tenant-access-policy";
import { countReservedSeats } from "@/modules/system-admin/entitlement";
import { assertTenantEntitlement } from "@/modules/system-admin/entitlement";
import {
  lockOrganization,
  recordPlatformAudit,
} from "@/modules/system-admin/platform-audit";
import { tenantTransaction } from "@/utils/tenant-transaction";
import { auditService } from "@/modules/audit/audit.service";
import { AppError } from "@/utils/AppError";
import type { RequestSubscriptionUpgradeInput } from "./organization.schema";
import type { ReviewUpgradeInput } from "@/modules/system-admin/billing.schema";

export const tenantUpgradeSelect = {
  id: true,
  planName: true,
  price: true,
  currency: true,
  billingInterval: true,
  maxActiveUsers: true,
  status: true,
  reason: true,
  reviewReason: true,
  createdAt: true,
  reviewedAt: true,
} satisfies Prisma.SubscriptionUpgradeRequestSelect;

function tenantRequest(request: SubscriptionUpgradeRequest) {
  return {
    id: request.id,
    planName: request.planName,
    price: request.price.toFixed(2),
    currency: request.currency,
    billingInterval: request.billingInterval,
    maxActiveUsers: request.maxActiveUsers,
    status: request.status,
    reason: request.reason,
    reviewReason: request.reviewReason,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
  };
}

async function eligiblePlan(
  db: Prisma.TransactionClient,
  id: string,
  organizationId: string,
  subscription: { currency: string; plan: { maxActiveUsers: number } },
) {
  const plan = await db.plan.findUnique({ where: { id } });
  if (
    !plan?.isActive ||
    plan.currency !== subscription.currency ||
    plan.maxActiveUsers <= subscription.plan.maxActiveUsers
  ) {
    throw new AppError(
      409,
      "Choose an available plan with a higher user limit in the same currency",
    );
  }
  if ((await countReservedSeats(db, organizationId)) > plan.maxActiveUsers) {
    throw new AppError(
      409,
      "The selected plan cannot accommodate your active users and pending invitations",
    );
  }
  return plan;
}

async function requireSubscriptionAdmin(db: Prisma.TransactionClient) {
  const ctx = requestContext.get();
  if (!ctx?.userId || !ctx.organizationId)
    throw new AppError(403, "Tenant administration is required");
  const actor = await loadAuthorization(ctx.userId, db);
  if (
    actor.organizationId !== ctx.organizationId ||
    !isTenantAdminName(actor.role.name)
  ) {
    throw new AppError(403, "Tenant administration is required");
  }
  return { actorId: actor.id, organizationId: ctx.organizationId };
}

export const subscriptionUpgradeService = {
  async plans() {
    await requireSubscriptionAdmin(prisma);
    return cachedRead("upgradePlans", "plans", [], async () => {
      return prisma.$transaction(
        async (db) => {
          const { organizationId } = await requireSubscriptionAdmin(db);
          const subscription = await db.subscription.findUnique({
            where: { organizationId },
            include: { plan: true },
          });
          if (!subscription) return { plans: [] };
          const used = await countReservedSeats(db, organizationId);
          const plans = await db.plan.findMany({
            where: {
              isActive: true,
              currency: subscription.currency,
              maxActiveUsers: { gt: subscription.plan.maxActiveUsers, gte: used },
            },
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              currency: true,
              billingInterval: true,
              maxActiveUsers: true,
              updatedAt: true,
            },
            orderBy: [{ maxActiveUsers: "asc" }, { price: "asc" }, { id: "asc" }],
          });
          return {
            plans: plans.map((plan) => ({
              ...plan,
              price: plan.price.toFixed(2),
            })),
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
    });
  },

  async request(input: RequestSubscriptionUpgradeInput) {
    return invalidating("upgradePlans", () => tenantTransaction(async (db) => {
      const { actorId, organizationId } = await requireSubscriptionAdmin(db);
      await lockOrganization(db, organizationId);
      const existing = await db.subscriptionUpgradeRequest.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing) {
        if (
          existing.actorId !== actorId ||
          existing.planId !== input.planId ||
          existing.reason !== input.reason
        ) {
          throw new AppError(
            409,
            "This retry key belongs to a different upgrade request",
          );
        }
        return tenantRequest(existing);
      }
      const subscription = await db.subscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      });
      if (!subscription)
        throw new AppError(
          409,
          "Ask your platform administrator to assign an initial plan",
        );
      if (
        !(await db.organization.findUnique({
          where: { id: organizationId, billingEnabled: true },
          select: { id: true },
        }))
      ) {
        throw new AppError(
          409,
          "Subscription billing must be enabled before requesting an upgrade",
        );
      }
      await assertTenantEntitlement(db, organizationId);
      if (
        await db.subscriptionUpgradeRequest.findUnique({
          where: { activeSubscriptionId: subscription.id },
        })
      ) {
        throw new AppError(
          409,
          "An upgrade request is already awaiting review",
        );
      }
      const plan = await eligiblePlan(
        db,
        input.planId,
        organizationId,
        subscription,
      );
      if (plan.updatedAt.toISOString() !== input.planUpdatedAt)
        throw new AppError(
          409,
          "This plan has changed. Refresh the available plans and try again",
        );
      const request = await db.subscriptionUpgradeRequest.create({
        data: {
          organizationId,
          subscriptionId: subscription.id,
          activeSubscriptionId: subscription.id,
          planId: plan.id,
          sourcePlanId: subscription.planId,
          subscriptionVersion: subscription.version,
          planName: plan.name,
          price: plan.price,
          currency: plan.currency,
          billingInterval: plan.billingInterval,
          maxActiveUsers: plan.maxActiveUsers,
          reason: input.reason,
          actorId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await auditService.recordInTransaction(db, {
        action: "subscription.upgrade.requested",
        entity: "SubscriptionUpgradeRequest",
        entityId: request.id,
        after: {
          planId: plan.id,
          planName: plan.name,
          maxActiveUsers: plan.maxActiveUsers,
          reason: input.reason,
        },
      });
      await recordPlatformAudit(db, {
        action: "platform.subscription.upgrade-requested",
        entity: "SubscriptionUpgradeRequest",
        entityId: request.id,
        organizationId,
        actorType: "USER",
        after: {
          subscriptionId: subscription.id,
          planId: plan.id,
          reason: input.reason,
        },
      });
      return tenantRequest(request);
    }));
  },

  async review(subscriptionId: string, input: ReviewUpgradeInput) {
    await requirePlatformAuthority();
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { organizationId: true },
    });
    if (!subscription) throw new AppError(404, "Subscription not found");
    return invalidating("upgradePlans", () => tenantTransaction(async (db) => {
      const actor = await requirePlatformAuthority(db);
      await lockOrganization(db, subscription.organizationId);
      const request = await db.subscriptionUpgradeRequest.findFirst({
        where: {
          id: input.requestId,
          subscriptionId,
          organizationId: subscription.organizationId,
        },
      });
      if (!request) throw new AppError(404, "Upgrade request not found");
      if (request.status === input.decision) return request;
      if (request.status !== "REQUESTED")
        throw new AppError(
          409,
          "This upgrade request has already been reviewed",
        );
      if (actor.id === request.actorId)
        throw new AppError(403, "You cannot review your own upgrade request");
      if (input.decision === "APPROVED") {
        const current = await db.subscription.findUnique({
          where: { id: subscriptionId },
          include: { plan: true },
        });
        if (
          !current ||
          current.planId !== request.sourcePlanId ||
          current.version !== request.subscriptionVersion
        ) {
          throw new AppError(
            409,
            "The subscription has changed. Reject this request and ask the tenant to submit a new one",
          );
        }
        await assertTenantEntitlement(db, subscription.organizationId);
        const plan = await eligiblePlan(
          db,
          request.planId,
          subscription.organizationId,
          current,
        );
        if (
          !plan.price.equals(request.price) ||
          plan.currency !== request.currency ||
          plan.billingInterval !== request.billingInterval ||
          plan.maxActiveUsers !== request.maxActiveUsers
        ) {
          throw new AppError(
            409,
            "The requested plan terms have changed. Reject this request and ask the tenant to submit a new one",
          );
        }
        // Match platform plan changes: update the ceiling immediately, preserving paid/trial coverage and price snapshot.
        await db.subscription.update({
          where: { id: subscriptionId },
          data: { planId: plan.id, version: { increment: 1 } },
        });
        await db.subscriptionHistory.create({
          data: {
            subscriptionId,
            kind: "PLAN_CHANGED",
            actorId: actor.id,
            reason: input.reason,
            before: { planId: current.planId, version: current.version },
            after: {
              planId: plan.id,
              version: current.version + 1,
              upgradeRequestId: request.id,
            },
          },
        });
      }
      const reviewed = await db.subscriptionUpgradeRequest.update({
        where: { id: request.id },
        data: {
          status: input.decision,
          activeSubscriptionId: null,
          reviewReason: input.reason,
          reviewedBy: actor.id,
          reviewedAt: new Date(),
        },
      });
      await recordPlatformAudit(db, {
        action: `platform.subscription.upgrade-${input.decision.toLowerCase()}`,
        entity: "SubscriptionUpgradeRequest",
        entityId: request.id,
        organizationId: request.organizationId,
        before: { status: request.status },
        after: {
          status: reviewed.status,
          planId: request.planId,
          reason: input.reason,
        },
      });
      return reviewed;
    }));
  },
};
