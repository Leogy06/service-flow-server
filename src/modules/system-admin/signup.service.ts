import type { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "@/lib/prisma.js";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
import { DEFAULT_ROLE_DEFINITIONS } from "@/constants/default-roles.js";
import { PUBLISHED_PRIVACY_VERSIONS, PUBLISHED_TERMS_VERSIONS } from "@/constants/legal.js";
import { AppError } from "@/utils/AppError.js";
import { comparePassword, hashedPassword } from "@/utils/bcrypPassword.js";
import { pagination } from "@/utils/tenant-transaction.js";
import { registerSchema, type RegisterInput } from "@/modules/auth/auth.schema.js";
import { platformTransaction, recordPlatformAudit } from "./platform-audit.js";
import { trialPeriod } from "./billing-policy.js";
import type { SignupListQuery, SignupReviewInput } from "./signup.schema.js";

const signupSelect = {
  id: true, email: true, firstName: true, lastName: true, middleName: true, suffix: true, phone: true,
  organizationName: true, slug: true, status: true, createdAt: true,
  termsAcceptedAt: true, termsVersion: true, privacyVersion: true,
  reviewedAt: true, reviewedBy: true, reviewReason: true,
  organization: { select: { id: true, name: true, slug: true, status: true } },
} satisfies Prisma.SignupRequestSelect;

const signupAcceptanceSelect = {
  id: true, status: true, passwordHash: true, termsAcceptedAt: true, termsVersion: true, privacyVersion: true,
} satisfies Prisma.SignupRequestSelect;
function canRecordLegacyAgreement(application: Prisma.SignupRequestGetPayload<{ select: typeof signupAcceptanceSelect }>) {
  return application.status === "PENDING" && application.passwordHash &&
    application.termsAcceptedAt === null && application.termsVersion === null && application.privacyVersion === null;
}

export const signupService = {
  async submit(input: RegisterInput) {
    // Enforce acceptance even when the service is called outside the HTTP route.
    const parsed = registerSchema.shape.body.safeParse(input);
    if (!parsed.success) throw new AppError(400, parsed.error.issues.map((issue) => issue.message).join(", "));
    const acceptedInput = parsed.data;
    // Hash even duplicate submissions; never disclose accounts or overwrite pending credentials.
    const passwordHash = await hashedPassword(acceptedInput.password);
    try {
      await platformTransaction(async (db) => {
        const existing = await db.user.findUnique({ where: { email: acceptedInput.email }, select: { id: true } });
        const application = await db.signupRequest.findUnique({ where: { email: acceptedInput.email }, select: signupAcceptanceSelect });
        if (existing) return;
        if (application) {
          // Only the original applicant can add missing legacy evidence. Preserve
          // the original identity, credentials and all existing acceptance records.
          if (!canRecordLegacyAgreement(application)) return;
          const locked = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM SignupRequest WHERE id = ${application.id} FOR UPDATE`;
          if (!locked.length) return;
          const current = await db.signupRequest.findUnique({ where: { id: application.id }, select: signupAcceptanceSelect });
          if (!current || !canRecordLegacyAgreement(current) || !await comparePassword(acceptedInput.password, current.passwordHash!)) return;
          const termsAcceptedAt = new Date();
          await db.signupRequest.update({ where: { id: current.id }, data: {
            termsAcceptedAt, termsVersion: acceptedInput.termsVersion, privacyVersion: acceptedInput.privacyVersion,
          } });
          await recordPlatformAudit(db, { action: "signup.agreement.recorded", entity: "SignupRequest", entityId: current.id,
            actorType: "SYSTEM", after: { status: "PENDING", termsAcceptedAt: termsAcceptedAt.toISOString(),
              termsVersion: acceptedInput.termsVersion, privacyVersion: acceptedInput.privacyVersion, privacyAcknowledged: true } });
          return;
        }
        const { password: _password, termsAccepted: _termsAccepted, privacyAcknowledged: _privacyAcknowledged, ...details } = acceptedInput;
        const termsAcceptedAt = new Date();
        const request = await db.signupRequest.create({ data: { ...details, passwordHash, termsAcceptedAt }, select: { id: true } });
        await recordPlatformAudit(db, { action: "signup.requested", entity: "SignupRequest", entityId: request.id,
          actorType: "SYSTEM", after: { status: "PENDING", termsAcceptedAt: termsAcceptedAt.toISOString(),
            termsVersion: details.termsVersion, privacyVersion: details.privacyVersion, privacyAcknowledged: true } });
      });
    } catch (error) {
      // A concurrent identical application has the same public response.
      if (!(error instanceof AppError && error.code === "DUPLICATE_RECORD")) throw error;
    }
    return { submitted: true };
  },

  async count() {
    await requirePlatformAuthority();
    return { pending: await prisma.signupRequest.count({ where: { status: "PENDING" } }) };
  },

  async list(query: SignupListQuery) {
    await requirePlatformAuthority();
    const where: Prisma.SignupRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: ["firstName", "lastName", "email", "organizationName", "slug"].map((field) => ({ [field]: { contains: query.search } })) } : {}),
    };
    return prisma.$transaction(async (db) => {
      const paging = pagination(query.page, query.pageSize, await db.signupRequest.count({ where }));
      const items = await db.signupRequest.findMany({ where, select: signupSelect,
        orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
        skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize });
      return { items, pagination: paging };
    }, { isolationLevel: "RepeatableRead" });
  },

  async review(id: string, input: SignupReviewInput) {
    return platformTransaction(async (db) => {
      const actor = await requirePlatformAuthority(db);
      const locked = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM SignupRequest WHERE id = ${id} FOR UPDATE`;
      if (!locked.length) throw new AppError(404, "Signup request not found");
      const application = await db.signupRequest.findUnique({ where: { id } });
      if (!application) throw new AppError(404, "Signup request not found");
      if (application.status !== "PENDING") {
        if (application.status === input.decision) return db.signupRequest.findUnique({ where: { id }, select: signupSelect });
        throw new AppError(409, "This signup request has already been reviewed");
      }
      let organizationId: string | undefined;
      if (input.decision === "APPROVED") {
        if (!application.termsAcceptedAt || !application.termsVersion || !application.privacyVersion ||
            !PUBLISHED_TERMS_VERSIONS.includes(application.termsVersion) || !PUBLISHED_PRIVACY_VERSIONS.includes(application.privacyVersion)) {
          throw new AppError(409, "Recorded agreement to the Terms of Service and acknowledgment of the Privacy Notice are required before approval. Legacy applicants can review the current documents and resubmit using their original signup email and password", "SIGNUP_AGREEMENT_REQUIRED");
        }
        if (!application.passwordHash) throw new AppError(409, "Signup credentials are unavailable");
        if (await db.user.findUnique({ where: { email: application.email }, select: { id: true } })) {
          throw new AppError(409, "An account already uses this email; reject this request and use account management");
        }
        if (application.phone && await db.user.findUnique({ where: { phone: application.phone }, select: { id: true } })) {
          throw new AppError(409, "An account already uses this phone number");
        }
        if (await db.organization.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
          throw new AppError(409, "Workspace address is already in use; choose another address");
        }
        const plan = await db.plan.findUnique({ where: { id: input.planId } });
        if (!plan?.isActive || plan.maxActiveUsers < 1) throw new AppError(409, "Choose an available plan with at least one user place");
        const permissionNames = [...new Set(DEFAULT_ROLE_DEFINITIONS.flatMap((role) => [...role.permissionNames]))];
        const permissions = await db.permission.findMany({ where: { name: { in: permissionNames }, organizationId: null }, select: { id: true, name: true } });
        if (permissions.length !== permissionNames.length) throw new AppError(409, "Default tenant permissions must be provisioned before approval");
        const organization = await db.organization.create({ data: { name: application.organizationName, slug: input.slug, billingEnabled: true } });
        organizationId = organization.id;
        let adminRoleId: string | undefined;
        for (const definition of DEFAULT_ROLE_DEFINITIONS) {
          const role = await db.role.create({ data: { name: definition.name, organizationId,
            permissions: { create: permissions.filter((permission) => definition.permissionNames.includes(permission.name))
              .map((permission) => ({ permissionId: permission.id, isActive: true })) },
          } });
          if (definition.name === "Admin") adminRoleId = role.id;
        }
        if (!adminRoleId) throw new Error("Default Admin role is missing");
        const user = await db.user.create({ data: {
          email: application.email, password: application.passwordHash, firstName: application.firstName, lastName: application.lastName,
          middleName: application.middleName, suffix: application.suffix, phone: application.phone,
          organizationId, roleId: adminRoleId, status: "ACTIVE", platformRole: "NONE",
        }, select: { id: true } });
        const trial = input.startTrial ? trialPeriod() : null;
        const subscription = await db.subscription.create({ data: {
          organizationId, planId: plan.id, price: plan.price, currency: plan.currency, billingInterval: plan.billingInterval,
          status: trial ? "TRIALING" : "PENDING",
          ...(trial ? { ...trial, startsAt: trial.trialStartedAt, expiresAt: trial.trialExpiresAt } : {}),
        } });
        await db.subscriptionHistory.create({ data: { subscriptionId: subscription.id, kind: trial ? "TRIAL_STARTED" : "ASSIGNED",
          actorId: actor.id, reason: input.reason, after: { status: subscription.status, planId: plan.id } } });
        await recordPlatformAudit(db, { action: "signup.workspace.created", entity: "Organization", entityId: organizationId, organizationId,
          after: { userId: user.id, roleId: adminRoleId, subscriptionId: subscription.id, planId: plan.id, status: subscription.status, reason: input.reason } });
      }
      const result = await db.signupRequest.update({ where: { id }, data: {
        status: input.decision, passwordHash: null, reviewedBy: actor.id, reviewedAt: new Date(), reviewReason: input.reason,
        ...(organizationId ? { organizationId } : {}),
      }, select: signupSelect });
      await recordPlatformAudit(db, { action: "signup.reviewed", entity: "SignupRequest", entityId: id, organizationId,
        before: { status: "PENDING" }, after: { status: input.decision, reason: input.reason } });
      return result;
    });
  },
};
