import { prisma } from "@/lib/prisma";
import { auditService } from "@/modules/audit/audit.service";
import { PERMISSIONS } from "@/constants/permission.constants";
import {
  accessTransaction,
  findManagedUser,
  requireTenantAdmin,
  userIsProtected,
  type TenantActor,
} from "@/modules/role/tenant-access-policy";
import { lockOrganization } from "@/modules/system-admin/platform-audit";
import type { Prisma } from "@/generated/prisma/client";
import { comparePassword, hashedPassword } from "@/utils/bcrypPassword";
import { AppError } from "@/utils/AppError";
import type { ResetStaffPasswordInput } from "./user-password.schema";

async function eligibleStaff(
  db: Prisma.TransactionClient,
  id: string,
  actor: TenantActor,
) {
  const staff = await findManagedUser(db, id, actor);
  if (staff.platformRole !== "NONE") throw new AppError(404, "User not found");
  if (userIsProtected(staff, actor))
    throw new AppError(
      403,
      "This account is protected from staff password resets",
    );
  if (staff.status !== "ACTIVE")
    throw new AppError(
      409,
      "Pending users must complete their invitation before a password can be reset",
    );
  return staff;
}

export const userPasswordService = {
  async resetStaffPassword(id: string, input: ResetStaffPasswordInput) {
    const actor = await requireTenantAdmin(prisma, PERMISSIONS.USER_UPDATE);
    // Check scope/protection before looking up credentials or doing password work.
    await eligibleStaff(prisma, id, actor);
    const credentials = await prisma.user.findFirst({
      where: {
        id: actor.user.id,
        organizationId: actor.organizationId,
        deletedAt: null,
        status: "ACTIVE",
        platformRole: "NONE",
        securityStatus: "ACTIVE",
      },
      select: { password: true },
    });
    if (
      !credentials?.password ||
      !(await comparePassword(input.currentPassword, credentials.password))
    ) {
      throw new AppError(400, "Your current password is incorrect");
    }
    const password = await hashedPassword(input.newPassword);
    return accessTransaction(async (db) => {
      await lockOrganization(db, actor.organizationId);
      const currentActor = await requireTenantAdmin(
        db,
        PERMISSIONS.USER_UPDATE,
      );
      const currentCredentials = await db.user.findFirst({
        where: {
          id: actor.user.id,
          organizationId: actor.organizationId,
          password: credentials.password,
          sessionVersion: actor.user.sessionVersion,
        },
        select: { id: true },
      });
      if (!currentCredentials)
        throw new AppError(
          409,
          "Your account changed. Sign in again and retry",
        );
      const staff = await eligibleStaff(db, id, currentActor);
      // Scope every write, including refresh-session revocation, to the trusted tenant.
      const updated = await db.user.updateMany({
        where: {
          id: staff.id,
          organizationId: currentActor.organizationId,
          deletedAt: null,
          status: "ACTIVE",
          platformRole: "NONE",
          sessionVersion: staff.sessionVersion,
        },
        data: {
          password,
          inviteToken: null,
          inviteTokenExpiry: null,
          sessionVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new AppError(
          409,
          "This staff account changed. Refresh and try again",
        );
      const sessions = await db.refreshToken.deleteMany({
        where: {
          userId: staff.id,
          organizationId: currentActor.organizationId,
        },
      });
      await auditService.recordInTransaction(db, {
        action: "auth.staff.password.reset.success",
        entity: "User",
        entityId: staff.id,
        after: { reason: input.reason, sessionsRevoked: sessions.count },
      });
      return { id: staff.id, sessionsRevoked: sessions.count };
    });
  },
};
