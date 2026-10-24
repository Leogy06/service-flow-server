import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendInviteEmail } from "@/lib/email/send-invite";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy";
import { emptyPageContent, pageContentSchema } from "@/modules/organization/page.schema";
import { AppError } from "@/utils/AppError";
import { invalidateModuleCache } from "@/utils/module-cache";
import { platformTransaction, recordPlatformAudit, lockOrganization } from "../platform-audit";
import { trialPeriod } from "../billing-policy";
import { createDefaultTenantRoles } from "./default-roles";
import { createDemoFixtures, removeDemoFixtures, sampleId } from "./demo-fixtures";
import { industryTemplate, industryTemplates, type IndustryId } from "./templates";
import { provisioningActionSchema, provisioningBody, type ProvisioningActionInput, type ProvisioningInput } from "./provisioning.schema";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const deliveryLeaseMs = 5 * 60_000;
const safeDeliveryError = "Invitation delivery failed. Retry after checking email delivery.";
async function record(db: Prisma.TransactionClient, id: string) {
  const row = await db.tenantProvisioning.findUnique({ where: { id } });
  if (!row) throw new AppError(404, "Provisioning record not found");
  return row;
}
function actionInput(id: string, input: ProvisioningActionInput) {
  return provisioningActionSchema.parse({ params: { id }, body: input }).body;
}

/** Shared API/worker boundary. Delivery runs only after durable provisioning commits. */
export function createProvisioningService({ sendInvitation = sendInviteEmail }: { sendInvitation?: typeof sendInviteEmail } = {}) {
  const service = {
    async templates() {
      await requirePlatformAuthority();
      return { templates: industryTemplates };
    },
    async template(id: IndustryId) {
      await requirePlatformAuthority();
      const template = industryTemplate(id);
      if (!template) throw new AppError(404, "Industry template not found");
      return { template };
    },

    async get(id: string) {
      await requirePlatformAuthority();
      return prisma.$transaction(async (db) => {
        await requirePlatformAuthority(db);
        const row = await record(db, id);
        const organizationId = row.organizationId;
        const [organization, owner, page, services, customers, requests, jobs, invoices, payments] = await Promise.all([
          db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true, isDemo: true, billingEnabled: true } }),
          db.user.findFirst({ where: { id: row.ownerId, organizationId }, select: { id: true, firstName: true, lastName: true, email: true, status: true } }),
          db.organizationPage.findUnique({ where: { organizationId }, select: { publishedAt: true } }),
          db.serviceType.count({ where: { organizationId } }), db.customer.count({ where: { organizationId } }),
          db.serviceRequest.count({ where: { organizationId } }), db.job.count({ where: { organizationId } }),
          db.invoice.count({ where: { organizationId } }), db.payment.count({ where: { invoice: { organizationId } } }),
        ]);
        if (!organization || !owner) throw new AppError(409, "Provisioning ownership is unavailable");
        // Deliberate projection: request hashes, token hashes, actor details and fixture manifests remain private.
        return {
          id: row.id, templateId: row.templateId, templateVersion: row.templateVersion, mode: row.mode,
          includeDemoData: row.includeDemoData, generateWebsite: row.generateWebsite,
          invitationStatus: row.invitationStatus, invitationAttemptedAt: row.invitationAttemptedAt,
          invitationError: row.invitationError, createdAt: row.createdAt, updatedAt: row.updatedAt,
          organization: { id: organization.id, name: organization.name, slug: organization.slug, isDemo: organization.isDemo, billingEnabled: organization.billingEnabled },
          owner: { id: owner.id, firstName: owner.firstName, lastName: owner.lastName, email: owner.email, status: owner.status },
          counts: { services, customers, requests, jobs, invoices, payments },
          website: { generated: !!page, published: !!page?.publishedAt },
        };
      }, { isolationLevel: "RepeatableRead" });
    },

    async create(untrusted: ProvisioningInput) {
      const input = provisioningBody.parse(untrusted);
      const actor = await requirePlatformAuthority();
      const id = hash(`${actor.id}:${input.idempotencyKey}`);
      const requestHash = hash(JSON.stringify(input));
      const template = industryTemplate(input.templateId);
      let created = false;
      try {
        created = await platformTransaction(async (db) => {
          const currentActor = await requirePlatformAuthority(db);
          if (currentActor.id !== actor.id) throw new AppError(403, "Platform administration is required");
          const existing = await db.tenantProvisioning.findUnique({ where: { id } });
          if (existing) {
            if (existing.requestHash !== requestHash) throw new AppError(409, "Idempotency key was already used for a different provisioning request");
            return false;
          }
          if (await db.organization.findUnique({ where: { slug: input.organization.slug }, select: { id: true } }))
            throw new AppError(409, "Workspace address is already in use");
          if (await db.user.findUnique({ where: { email: input.owner.email }, select: { id: true } }))
            throw new AppError(409, "An account already uses this owner email");
          // Pending public applications must still be reviewed through their legal-evidence workflow.
          if (await db.signupRequest.findUnique({ where: { email: input.owner.email, status: "PENDING" }, select: { id: true } }))
            throw new AppError(409, "This email has a signup application. Review that application before provisioning another workspace.");
          const plan = input.mode === "REAL" ? await db.plan.findUnique({ where: { id: input.planId } }) : null;
          if (input.mode === "REAL" && (!plan?.isActive || plan.maxActiveUsers < 1))
            throw new AppError(409, "Choose an available plan with at least one user place");
          const organization = await db.organization.create({ data: {
            name: input.organization.name, slug: input.organization.slug, isDemo: input.mode === "DEMO", billingEnabled: input.mode === "REAL",
          } });
          const organizationId = organization.id;
          const roleId = await createDefaultTenantRoles(db, organizationId);
          const owner = await db.user.create({ data: {
            ...input.owner, organizationId, roleId, platformRole: "NONE", securityStatus: "ACTIVE", status: "PENDING", password: null,
          }, select: { id: true } });
          if (plan) {
            const trial = input.mode === "REAL" && input.startTrial ? trialPeriod() : null;
            const subscription = await db.subscription.create({ data: {
              organizationId, planId: plan.id, price: plan.price, currency: plan.currency, billingInterval: plan.billingInterval,
              status: trial ? "TRIALING" : "PENDING",
              ...(trial ? { ...trial, startsAt: trial.trialStartedAt, expiresAt: trial.trialExpiresAt } : {}),
            } });
            await db.subscriptionHistory.create({ data: {
              subscriptionId: subscription.id, kind: trial ? "TRIAL_STARTED" : "ASSIGNED", actorId: actor.id,
              reason: input.reason, after: { status: subscription.status, planId: plan.id },
            } });
          }
          await db.serviceType.createMany({ data: template.services.map((item, index) => ({
            id: sampleId(id, `service:${index}`), organizationId, name: item.name,
            description: `${item.description} Pricing requires owner confirmation; enter the agreed base price and activate this service before use.`,
            basePrice: new Prisma.Decimal(0), isActive: false,
          })) });
          if (input.generateWebsite) {
            const draft = pageContentSchema.parse({
              ...emptyPageContent(), headline: template.website.headline,
              about: `${input.organization.name}. ${template.website.about}`,
              services: template.services.map((item) => ({ ...item })),
            });
            await db.organizationPage.create({ data: { organizationId, draft } });
          }
          const demoManifest = input.mode === "DEMO" && input.includeDemoData
            ? await createDemoFixtures(db, id, organizationId, template) : undefined;
          await db.tenantProvisioning.create({ data: {
            id, actorId: actor.id, requestHash, organizationId, ownerId: owner.id,
            templateId: template.id, templateVersion: template.version, mode: input.mode,
            includeDemoData: input.includeDemoData, generateWebsite: input.generateWebsite,
            invitationStatus: "PENDING", ...(demoManifest ? { demoManifest } : {}),
          } });
          await recordPlatformAudit(db, {
            action: "platform.provisioning.completed", entity: "TenantProvisioning", entityId: id, organizationId,
            after: { templateId: template.id, templateVersion: template.version, mode: input.mode,
              includeDemoData: input.includeDemoData, generateWebsite: input.generateWebsite, ownerId: owner.id,
              ...(plan ? { planId: plan.id, startTrial: input.mode === "REAL" && input.startTrial } : {}), reason: input.reason },
          });
          return true;
        });
      } catch (error) {
        // A unique-index race can finish after the other transaction commits. Only
        // the same actor, key and normalized payload qualify as a successful replay.
        if (!(error instanceof AppError && error.code === "DUPLICATE_RECORD")) throw error;
        await requirePlatformAuthority();
        const existing = await prisma.tenantProvisioning.findUnique({ where: { id } });
        if (!existing) throw error;
        if (existing.requestHash !== requestHash) throw new AppError(409, "Idempotency key was already used for a different provisioning request");
      }
      logger.info({ event: created ? "provisioning.committed" : "provisioning.replayed", provisioningId: id, templateId: template.id, mode: input.mode }, "Tenant provisioning committed");
      if (created) await deliverInvitation(id, input.reason);
      return service.get(id);
    },

    async resendInvitation(id: string, untrusted: ProvisioningActionInput) {
      const input = actionInput(id, untrusted);
      await deliverInvitation(id, input.reason);
      return service.get(id);
    },

    async resetDemo(id: string, untrusted: ProvisioningActionInput) {
      const input = actionInput(id, untrusted);
      await requirePlatformAuthority();
      let organizationId = "";
      await platformTransaction(async (db) => {
        await requirePlatformAuthority(db);
        const row = await record(db, id);
        organizationId = row.organizationId;
        await lockOrganization(db, organizationId);
        const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { isDemo: true } });
        if (row.mode !== "DEMO" || !organization?.isDemo || !row.includeDemoData)
          throw new AppError(409, "Only demo workspaces with generated sample operations can be reset");
        const template = industryTemplate(row.templateId as IndustryId);
        if (!template || template.version !== row.templateVersion)
          throw new AppError(409, "The original sample template is unavailable; no records were removed");
        await removeDemoFixtures(db, organizationId, row.demoManifest);
        const demoManifest = await createDemoFixtures(db, row.id, organizationId, template);
        await db.tenantProvisioning.update({ where: { id }, data: { demoManifest } });
        await recordPlatformAudit(db, { action: "platform.provisioning.demo_reset", entity: "TenantProvisioning", entityId: id,
          organizationId, after: { templateId: template.id, reason: input.reason } });
      });
      await invalidateModuleCache(["customers", "serviceRequests", "jobs", "invoices", "dashboard"], organizationId);
      logger.info({ event: "provisioning.demo_reset", provisioningId: id, organizationId }, "Demo sample operations reset");
      return service.get(id);
    },
  };

  async function deliverInvitation(id: string, reason: string) {
    await requirePlatformAuthority();
    const claim = await platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const initial = await record(db, id);
      await lockOrganization(db, initial.organizationId);
      const row = await record(db, id);
      if (row.invitationStatus === "SENDING" && row.invitationAttemptedAt && row.invitationAttemptedAt.getTime() > Date.now() - deliveryLeaseMs)
        throw new AppError(409, "An invitation is being sent. Wait before retrying.");
      const owner = await db.user.findFirst({ where: {
        id: row.ownerId, organizationId: row.organizationId, deletedAt: null, status: "PENDING", password: null,
        securityStatus: "ACTIVE", platformRole: "NONE", organization: { status: "ACTIVE" },
        role: { organizationId: row.organizationId, deletedAt: null },
      }, select: { id: true, email: true, firstName: true } });
      if (!owner) throw new AppError(409, "Owner invitation is unavailable or has already been accepted");
      const token = randomBytes(32).toString("hex");
      const attemptId = randomBytes(32).toString("hex");
      const attemptedAt = new Date();
      await db.user.update({ where: { id: owner.id }, data: { inviteToken: hash(token), inviteTokenExpiry: new Date(attemptedAt.getTime() + 86_400_000) } });
      await db.tenantProvisioning.update({ where: { id }, data: {
        invitationStatus: "SENDING", invitationAttemptId: attemptId, invitationAttemptedAt: attemptedAt, invitationError: null,
      } });
      await recordPlatformAudit(db, { action: "platform.provisioning.invitation_requested", entity: "TenantProvisioning", entityId: id,
        organizationId: row.organizationId, after: { ownerId: owner.id, reason } });
      return { owner, token, attemptId, organizationId: row.organizationId };
    });
    let sent = false;
    try { await sendInvitation({ to: claim.owner.email, firstName: claim.owner.firstName, token: claim.token }); sent = true; }
    catch { /* The committed workspace remains recoverable; provider details never enter state or logs. */ }
    const finalized = await platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      await lockOrganization(db, claim.organizationId);
      const updated = await db.tenantProvisioning.updateMany({ where: { id, invitationAttemptId: claim.attemptId }, data: {
        invitationStatus: sent ? "SENT" : "FAILED", invitationError: sent ? null : safeDeliveryError,
      } });
      if (updated.count) await recordPlatformAudit(db, { action: sent ? "platform.provisioning.invitation_sent" : "platform.provisioning.invitation_failed",
        entity: "TenantProvisioning", entityId: id, organizationId: claim.organizationId, after: { status: sent ? "SENT" : "FAILED" } });
      return updated.count === 1;
    });
    if (finalized) logger.info({ event: sent ? "provisioning.invitation_sent" : "provisioning.invitation_failed", provisioningId: id, organizationId: claim.organizationId }, "Owner invitation delivery processed");
  }
  return service;
}

export const provisioningService = createProvisioningService();
