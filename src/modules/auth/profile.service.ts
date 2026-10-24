import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/requestContext";
import { env } from "@/config/env";
import { auditService } from "@/modules/audit/audit.service";
import { AppError } from "@/utils/AppError";
import { comparePassword, hashedPassword } from "@/utils/bcrypPassword";
import { invalidateModuleCache } from "@/utils/module-cache";
import { isPrismaError } from "@/utils/errorHelper";
import { loadAuthorization, resolvePermissions } from "./authorization";
import type { ChangePasswordInput, UpdateProfileInput } from "./profile.schema";
import { revokeAuthenticationFactors } from "./authentication-factors";

const profileSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  middleName: true,
  suffix: true,
  phone: true,
  status: true,
  createdAt: true,
  platformRole: true,
  securityStatus: true,
  organization: { select: { id: true, name: true, slug: true, status: true } },
} satisfies Prisma.UserSelect;

async function self(db: Prisma.TransactionClient) {
  const id = requestContext.getValue("userId");
  if (!id) throw new AppError(401, "Authentication is required");
  const user = await loadAuthorization(id, db);
  if (
    user.organizationId !== (requestContext.getValue("organizationId") ?? null)
  ) {
    throw new AppError(401, "Session is no longer valid");
  }
  return user;
}

async function readProfile(db: Prisma.TransactionClient) {
  const actor = await self(db);
  const user = await db.user.findFirst({
    where: {
      id: actor.id,
      organizationId: actor.organizationId,
      deletedAt: null,
      status: "ACTIVE",
    },
    select: profileSelect,
  });
  if (!user) throw new AppError(401, "Session is no longer valid");
  const activeSessions = await db.refreshToken.count({
    where: {
      userId: actor.id,
      organizationId: actor.organizationId,
      expiresAt: { gt: new Date() },
    },
  });
  return {
    ...user,
    role: { id: actor.role.id, name: actor.role.name },
    permissions: resolvePermissions(actor).names.sort(),
    activeSessions,
    sessionExpiryMinutes: Math.ceil(env.ACCESS_TOKEN_EXPIRY / 60),
  };
}

async function profileMutation<T>(
  work: (db: Prisma.TransactionClient) => Promise<T>,
) {
  try {
    const result = await prisma.$transaction(work, {
      isolationLevel: "Serializable",
      timeout: 10000,
    });
    await invalidateModuleCache("users");
    return result;
  } catch (error) {
    if (isPrismaError(error, "P2002"))
      throw new AppError(409, "This phone number is already in use");
    if (isPrismaError(error, "P2034") || isPrismaError(error, "P2025")) {
      throw new AppError(409, "Your account changed. Refresh and try again");
    }
    throw error;
  }
}

export const profileService = {
  get() {
    return prisma.$transaction(readProfile, {
      isolationLevel: "RepeatableRead",
    });
  },
  update(input: UpdateProfileInput) {
    return profileMutation(async (db) => {
      const before = await readProfile(db);
      // Explicit fields prevent changes to email, organization, role or permissions.
      const data = {
        firstName: input.firstName,
        lastName: input.lastName,
        middleName: input.middleName || null,
        suffix: input.suffix || null,
        phone: input.phone,
      };
      await db.user.update({
        where: {
          id: before.id,
          organizationId: before.organization?.id ?? null,
          deletedAt: null,
          status: "ACTIVE",
        },
        data,
        select: { id: true },
      });
      await auditService.recordInTransaction(db, {
        action: "update.profile.success",
        entity: "User",
        entityId: before.id,
        before: {
          firstName: before.firstName,
          lastName: before.lastName,
          middleName: before.middleName,
          suffix: before.suffix,
          phone: before.phone,
        },
        after: data,
      });
      return readProfile(db);
    });
  },
  async changePassword(input: ChangePasswordInput) {
    const actor = await self(prisma);
    const where = {
      id: actor.id,
      organizationId: actor.organizationId,
      deletedAt: null,
      status: "ACTIVE" as const,
    };
    const credentials = await prisma.user.findFirst({
      where,
      select: { password: true },
    });
    if (
      !credentials?.password ||
      !(await comparePassword(input.currentPassword, credentials.password))
    ) {
      // A 400 avoids triggering the client's expired-session recovery for a wrong password.
      throw new AppError(400, "Current password is incorrect");
    }
    if (await comparePassword(input.newPassword, credentials.password)) {
      throw new AppError(
        400,
        "Choose a password different from your current password",
      );
    }
    const password = await hashedPassword(input.newPassword);
    return profileMutation(async (db) => {
      await self(db);
      const updated = await db.user.updateMany({
        where: { ...where, password: credentials.password },
        data: { password, sessionVersion: { increment: 1 } },
      });
      if (updated.count !== 1)
        throw new AppError(
          409,
          "Your account changed. Try again with your current password",
        );
      const revoked = await db.refreshToken.deleteMany({
        where: { userId: actor.id, organizationId: actor.organizationId },
      });
      await revokeAuthenticationFactors(db, actor.id);
      await auditService.recordInTransaction(db, {
        action: "auth.password.change.success",
        entity: "User",
        entityId: actor.id,
        after: { sessionsRevoked: revoked.count },
      });
      return { sessionsRevoked: revoked.count };
    });
  },
  logoutAll() {
    return profileMutation(async (db) => {
      const actor = await self(db);
      await db.user.updateMany({
        where: { id: actor.id, organizationId: actor.organizationId },
        data: { sessionVersion: { increment: 1 } },
      });
      const revoked = await db.refreshToken.deleteMany({
        where: { userId: actor.id, organizationId: actor.organizationId },
      });
      await revokeAuthenticationFactors(db, actor.id);
      await auditService.recordInTransaction(db, {
        action: "auth.logout.all.success",
        entity: "User",
        entityId: actor.id,
        after: { sessionsRevoked: revoked.count },
      });
      return { sessionsRevoked: revoked.count };
    });
  },
};
