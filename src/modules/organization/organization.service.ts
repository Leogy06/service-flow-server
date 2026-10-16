import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";
import { requestContext } from "@/lib/requestContext.js";
import { isTenantAdminName, requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
import { platformTransaction, recordPlatformAudit } from "@/modules/system-admin/platform-audit.js";
import { countActiveSeats } from "@/modules/system-admin/entitlement.js";
import { entitlementIsCurrent } from "@/modules/system-admin/billing-policy.js";
import type { OrganizationInput } from "./organization.schema.js";

export const organizationService = {
  async subscription() {
    // authenticate reloads the actor's role and tenant from the database.
    const ctx = requestContext.get();
    if (!ctx?.userId || !ctx.organizationId || !ctx.role || !isTenantAdminName(ctx.role)) {
      throw new AppError(403, "Tenant administration is required");
    }
    const organizationId = ctx.organizationId;
    return prisma.$transaction(async (db) => {
      const organization = await db.organization.findUnique({
        where: { id: organizationId, status: "ACTIVE" },
        select: { name: true, billingEnabled: true, subscription: { select: {
          status: true, startsAt: true, expiresAt: true, trialStartedAt: true, trialExpiresAt: true,
          price: true, currency: true, billingInterval: true,
          plan: { select: { name: true, maxActiveUsers: true } },
        } } },
      });
      if (!organization) throw new AppError(404, "Organization not found");
      const { subscription, ...tenant } = organization;
      const settings = subscription?.status === "PAST_DUE"
        ? await db.platformSettings.findUnique({ where: { id: "singleton" }, select: { gracePeriodDays: true } }) : null;
      const now = new Date();
      const gracePeriodDays = Math.max(0, Math.min(30, settings?.gracePeriodDays ?? 0));
      const isCurrent = entitlementIsCurrent(subscription, gracePeriodDays, now);
      const graceEndsAt = subscription?.status === "PAST_DUE" && subscription.expiresAt && gracePeriodDays > 0
        ? new Date(subscription.expiresAt.getTime() + gracePeriodDays * 86_400_000) : null;
      return {
        organizationName: tenant.name,
        billingEnabled: tenant.billingEnabled,
        accessAllowed: !tenant.billingEnabled || isCurrent,
        checkedAt: now,
        activeUsers: await countActiveSeats(db, organizationId),
        graceEndsAt,
        subscription: subscription ? {
          ...subscription, price: subscription.price.toFixed(2),
          // Expiry is enforced at request time, even before the alert worker runs.
          effectiveStatus: !isCurrent && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscription.status) &&
            subscription.expiresAt && subscription.expiresAt <= now ? "EXPIRED" as const : subscription.status,
        } : null,
      };
    }, { isolationLevel: "RepeatableRead" });
  },

  async create(input: OrganizationInput) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const organization = await db.organization.create({ data: { name: input.name, slug: input.slug } });
      await recordPlatformAudit(db, { action: "platform.organization.create", entity: "Organization", entityId: organization.id,
        organizationId: organization.id, after: { id: organization.id, name: organization.name, slug: organization.slug, reason: input.reason } });
      return organization;
    });
  },

  async list() {
    await requirePlatformAuthority();
    return await prisma.organization.findMany();
  },

  async getById(organizationId: string) {
    if (!organizationId) throw new AppError(422, "Organization id is missing");
    if (requestContext.getValue("organizationId") !== organizationId) await requirePlatformAuthority();

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId, status: "ACTIVE" },
      select: {
        name: true,
        slug: true,
      },
    });
    if (!organization) throw new AppError(404, "Organization not found");
    return organization;
  },

  async checkSlug(slug: string) {
    const cleanSlug = slug?.trim().toLowerCase();
    if (!cleanSlug) throw new AppError(422, "Organization slug is missing");

    // console.log("Slug: ", cleanSlug);

    const organization = await prisma.organization.findUnique({
      where: { slug: cleanSlug, status: "ACTIVE" },
      select: { name: true, slug: true },
    });
    if (!organization) throw new AppError(404, "Organization not found");

    return organization;
  },
};
