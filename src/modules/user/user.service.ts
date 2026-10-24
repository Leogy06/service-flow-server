import { Prisma, UserStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertDemoActionAllowed } from "@/lib/demo-guard";
import { revokeAuthenticationFactors } from "@/modules/auth/authentication-factors";
import { AppError } from "@/utils/AppError";
import { cachedRead, invalidateModuleCache } from "@/utils/module-cache";
import { hashedPassword } from "@/utils/bcrypPassword";
import { CreateUserInput } from "@/types/index";
import crypto from "node:crypto";
import { sendInviteEmail } from "@/lib/email/send-invite";
import { auditService } from "@/modules/audit/audit.service";
import { SetPasswordSchema } from "./user.schema";
import { requestContext } from "@/lib/requestContext";
import { UserUpdateInput } from "./types";
import { userScope } from "@/utils/user-utils/user-scope";
import { isPrismaError } from "@/utils/errorHelper";
import { stripSecrets } from "@/utils/user-utils/stripSecrets";
import { PERMISSIONS } from "@/constants/permission.constants";
import {
  accessTransaction,
  requireAssignableRole,
  requireTenantAdmin,
} from "@/modules/role/tenant-access-policy";
import {
  authorizationSelect,
  resolvePermissions,
} from "@/modules/auth/authorization";
import {
  assertTenantEntitlement,
  enforceSeatLimit,
} from "@/modules/system-admin/entitlement";
import { lockOrganization } from "@/modules/system-admin/platform-audit";

const DEFAULT_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  middleName: true,
  suffix: true,
  role: true,
  status: true,
  organizationId: true,
  phone: true,
  deletedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

interface ListProps {
  select?: Prisma.UserSelect;
  page?: number;
  pageSize?: number;
  search?: string;
  sortOrder?: "asc" | "desc";
  sortBy?: string;
  organizationId: string;
  status?: "active" | "pending" | null;
  roleName?: "Admin" | "Manager";
  roleId?: string;
  deleted: boolean;
}

const ALLOWED_SORT_FIELDS = ["createdAt", "firstName", "lastName", "email"];

export const userService = {
  async getById(
    id: string,
    organizationId: string,
    opts: { deleted?: boolean; select?: Prisma.UserSelect } = {},
  ) {
    const { deleted = false, select = DEFAULT_USER_SELECT } = opts;

    // This lookup is used to validate mutations; always read current DB state.
    const user = await prisma.user.findUnique({
      where: { id, ...userScope(organizationId, { deleted }) },
      select,
    });

    if (!user) throw new AppError(404, "User not found");
    return user;
  },

  async list({
    select = DEFAULT_USER_SELECT,
    page = 1,
    pageSize = 10,
    search = "",
    sortOrder = "desc",
    sortBy = "createdAt",
    organizationId,
    status, // active | pending
    roleName,
    roleId,
    deleted,
  }: ListProps) {
    if (!organizationId) throw new AppError(400, "Organization ID is required");
    if (!ALLOWED_SORT_FIELDS.includes(sortBy)) sortBy = "createdAt";

    const where: Prisma.UserWhereInput = {
      organizationId,
      AND: search
        ? search
            .split(/[\s,]+/)
            .filter(Boolean)
            .map((term) => ({
              OR: [
                { firstName: { contains: term } },
                { lastName: { contains: term } },
                { middleName: { contains: term } },
                { suffix: { contains: term } },
                { email: { contains: term } },
              ],
            }))
        : undefined,
      deletedAt: deleted ? { not: null } : null,
      ...(status === "active" ? { status: UserStatus.ACTIVE } : {}),
      ...(status === "pending" ? { status: UserStatus.PENDING } : {}),
      ...(roleId ? { roleId } : {}),
      role: {
        organizationId,
        deletedAt: null,
        ...(roleName ? { name: roleName } : {}),
      },
    };

    const { users, total, currentPage, totalPages } = await cachedRead(
      "users", "list", { select, page, pageSize, search, sortOrder, sortBy, status, roleId, roleName, deleted },
      async () => {
        return prisma.$transaction(
          async (db) => {
            const total = await db.user.count({ where });
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const currentPage = Math.min(page, totalPages);
            const users = await db.user.findMany({
              where,
              select,
              orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
              skip: (currentPage - 1) * pageSize,
              take: pageSize,
            });
            return { users, total, currentPage, totalPages };
          },
          { isolationLevel: "RepeatableRead" },
        );
      },
      { scope: organizationId },
    );

    return {
      users,
      pagination: {
        total,
        totalPages,
        page: currentPage,
        pageSize,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
    };
  },

  async listRoles(organizationId: string) {
    if (!organizationId) throw new AppError(400, "Organization ID is required");
    return cachedRead("roles", "userChoices", [], () => prisma.role.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }), { scope: organizationId });
  },

  async invalidateUserCache() {
    await invalidateModuleCache("users");
  },

  async validateCreateInput(input: CreateUserInput) {
    const [isEmailExist, isPhoneExist] = await Promise.all([
      prisma.user.findUnique({ where: { email: input.email } }),
      input.phone
        ? prisma.user.findUnique({ where: { phone: input.phone } })
        : null,
    ]);
    if (isEmailExist) throw new AppError(409, "Email already in use");
    if (isPhoneExist) throw new AppError(409, "Phone already in use");

    if (input.organizationId) {
      const organization = await prisma.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!organization) throw new AppError(404, "Organization not found");
    }

    if (input.roleId) {
      const role = await prisma.role.findFirst({
        where: {
          id: input.roleId,
          organizationId: input.organizationId,
          deletedAt: null,
        },
      });
      if (!role) throw new AppError(404, "Role not found");
    }
    return input;
  },

  async createDirect(input: CreateUserInput) {
    const actor = await requireTenantAdmin(prisma, PERMISSIONS.USER_CREATE);
    await assertDemoActionAllowed(prisma, actor.organizationId, "add staff accounts");
    input = { ...input, organizationId: actor.organizationId };
    if (!input.password) throw new AppError(400, "Password is required");
    //check email duplication and phone
    await this.validateCreateInput(input);

    const password = await hashedPassword(input.password!);

    const user = await accessTransaction(async (db) => {
      const currentActor = await requireTenantAdmin(
        db,
        PERMISSIONS.USER_CREATE,
      );
      await assertDemoActionAllowed(db, currentActor.organizationId, "add staff accounts");
      await requireAssignableRole(db, input.roleId, currentActor);
      await enforceSeatLimit(db, currentActor.organizationId, 1, {
        includePending: true,
      });
      const created = await db.user.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          middleName: input.middleName,
          suffix: input.suffix,
          email: input.email,
          phone: input.phone,
          password,
          status: "ACTIVE",
          role: {
            connect: {
              id: input.roleId,
            },
          },
          organization: {
            connect: {
              id: input.organizationId,
            },
          },
        },
      });
      await auditService.recordInTransaction(db, {
        action: "create.user.success",
        entity: "User",
        entityId: created.id,
        after: stripSecrets(created),
      });
      return created;
    });

    await this.invalidateUserCache();

    return stripSecrets(user);
  },

  async createWithInvite(input: CreateUserInput) {
    const actor = await requireTenantAdmin(prisma, PERMISSIONS.USER_CREATE);
    await assertDemoActionAllowed(prisma, actor.organizationId, "invite staff");
    input = { ...input, organizationId: actor.organizationId };
    await this.validateCreateInput(input);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const inviteTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await accessTransaction(async (db) => {
      const currentActor = await requireTenantAdmin(
        db,
        PERMISSIONS.USER_CREATE,
      );
      await assertDemoActionAllowed(db, currentActor.organizationId, "invite staff");
      await requireAssignableRole(db, input.roleId, currentActor);
      await enforceSeatLimit(db, currentActor.organizationId, 1, {
        includePending: true,
      });
      const created = await db.user.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          middleName: input.middleName,
          suffix: input.suffix,
          email: input.email,
          phone: input.phone,
          password: null,
          status: "PENDING",
          securityStatus: "ACTIVE",
          platformRole: "NONE",
          inviteToken: hashedToken,
          inviteTokenExpiry,
          role: {
            connect: {
              id: input.roleId,
            },
          },
          organization: {
            connect: {
              id: input.organizationId,
            },
          },
        },
      });
      await auditService.recordInTransaction(db, {
        action: "create.user.success",
        entity: "User",
        entityId: created.id,
        after: stripSecrets(created),
      });
      return created;
    });

    await this.invalidateUserCache();

    try {
      await sendInviteEmail({
        to: user.email,
        firstName: user.firstName,
        token: rawToken,
      });
    } catch (err) {
      console.error("Failed to send invite email for user", user.id, err);
      // don't throw — user already created, admin can resend invite later
    }

    return stripSecrets(user);
  },

  async resetTokenExpirationDateInvitation(token: string, email: string) {
    if (!token || !email) {
      throw new AppError(400, "Token and email are required");
    }

    const user = await prisma.user.findUnique({
      where: {
        email: email,
        inviteToken: token,
      },
    });

    if (!user) {
      throw new AppError(404, "User not found");
    }

    //check if active status still pending
    if (user?.status !== "PENDING") {
      throw new AppError(400, "User is not pending");
    }

    //check if user has already a password
    if (user?.password) {
      throw new AppError(400, "User already has a password");
    }

    //add another 24h to the expiration date
    const inviteTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const updatedUser = await prisma.user.update({
      where: { id: user?.id },
      data: { inviteTokenExpiry },
    });

    void auditService.record({
      action: "reset.token.expiration.date.success",
      entity: "User",
      entityId: updatedUser.id,
      after: updatedUser,
    });

    return updatedUser;
  },

  async setPassword(input: SetPasswordSchema) {
    const inviteToken = crypto
      .createHash("sha256")
      .update(input.token)
      .digest("hex");
    const invalidInvite = () =>
      new AppError(
        400,
        "Invite link is invalid or expired. Please request a new invitation.",
      );
    const user = await prisma.user.findUnique({
      where: {
        email: input.email,
        inviteToken,
        deletedAt: null,
        status: "PENDING",
        securityStatus: "ACTIVE",
        platformRole: "NONE",
        password: null,
        inviteTokenExpiry: { gt: new Date() },
        organization: { status: "ACTIVE" },
        role: { deletedAt: null },
      },
      select: {
        id: true,
        organizationId: true,
        role: { select: { organizationId: true } },
      },
    });

    if (
      !user?.organizationId ||
      user.role.organizationId !== user.organizationId
    )
      throw invalidInvite();

    //check if password and confirm password match
    if (input.password !== input.confirmPassword)
      throw new AppError(400, "Password and confirm password do not match");

    const password = await hashedPassword(input.password);
    const organizationId = user.organizationId;
    await prisma.$transaction(
      async (db) => {
        await enforceSeatLimit(db, organizationId);
        await assertTenantEntitlement(db, organizationId);
        // Recheck and consume the invitation atomically so concurrent submissions cannot overwrite it.
        const result = await db.user.updateMany({
          where: {
            id: user.id,
            organizationId,
            email: input.email,
            inviteToken,
            status: "PENDING",
            password: null,
            deletedAt: null,
            securityStatus: "ACTIVE",
            platformRole: "NONE",
            inviteTokenExpiry: { gt: new Date() },
            organization: { status: "ACTIVE" },
            role: { organizationId, deletedAt: null },
          },
          data: {
            password,
            status: "ACTIVE",
            inviteToken: null,
            inviteTokenExpiry: null,
            sessionVersion: { increment: 1 },
          },
        });
        if (result.count !== 1) throw invalidInvite();
        await db.refreshToken.deleteMany({ where: { userId: user.id, organizationId } });
        await revokeAuthenticationFactors(db, user.id);

        // The verified invitation establishes the actor and tenant for this public operation.
        await requestContext.run(
          {
            ...requestContext.get(),
            requestId:
              requestContext.getValue("requestId") ?? crypto.randomUUID(),
            userId: user.id,
            organizationId,
          },
          () =>
            auditService.recordInTransaction(db, {
              action: "set.password.success",
              entity: "User",
              entityId: user.id,
              after: { status: "ACTIVE" },
            }),
        );
      },
      { isolationLevel: "Serializable" },
    );

    await invalidateModuleCache("users", organizationId);
    return null;
  },

  async update(id: string, input: UserUpdateInput, authUserOrg: string) {
    await this.getById(id, authUserOrg); // 404 if missing, deleted, other org

    const [byEmail, byPhone] = await Promise.all([
      input.email
        ? prisma.user.findUnique({
            where: { email: input.email },
            select: { id: true },
          })
        : null,
      input.phone
        ? prisma.user.findUnique({
            where: { phone: input.phone },
            select: { id: true },
          })
        : null,
    ]);
    if (byEmail && byEmail.id !== id)
      throw new AppError(409, "Email already in use");
    if (byPhone && byPhone.id !== id)
      throw new AppError(409, "Phone number already in use");

    let user;
    try {
      user = await accessTransaction(async (db) => {
        await lockOrganization(db, authUserOrg);
        const current = await db.user.findFirst({ where: { id, ...userScope(authUserOrg) } });
        if (!current) throw new AppError(404, "User not found");
        const emailChanged = input.email !== undefined && input.email !== current.email;
        const updated = await db.user.update({
          where: { id, ...userScope(authUserOrg) },
          data: {
            firstName: input.firstName,
            lastName: input.lastName,
            middleName: input.middleName,
            suffix: input.suffix,
            email: input.email,
            phone: input.phone,
            ...(emailChanged ? { sessionVersion: { increment: 1 }, inviteToken: null, inviteTokenExpiry: null } : {}),
          },
        });
        if (emailChanged) {
          await db.refreshToken.deleteMany({ where: { userId: id, organizationId: authUserOrg } });
          await revokeAuthenticationFactors(db, id);
        }
        await auditService.recordInTransaction(db, {
          action: "update.user.success",
          entity: "User",
          entityId: updated.id,
          before: stripSecrets(current),
          after: stripSecrets(updated),
        });
        return updated;
      });
    } catch (error) {
      if (isPrismaError(error, "P2025"))
        throw new AppError(404, "User not found");
      if (isPrismaError(error, "P2002"))
        throw new AppError(409, "Email or phone already in use");
      throw error;
    }

    const safe = stripSecrets(user);

    await this.invalidateUserCache();
    return safe;
  },

  async delete(id: string, authUserOrg: string, actorId: string) {
    if (actorId === id) {
      throw new AppError(400, "You cannot delete your own account.");
    }

    await this.getById(id, authUserOrg);

    let user;

    try {
      user = await accessTransaction(async (db) => {
        await lockOrganization(db, authUserOrg);
        const current = await db.user.findFirst({
          where: { id, ...userScope(authUserOrg), platformRole: "NONE" },
        });
        if (!current) throw new AppError(404, "User not found");
        const deleted = await db.user.update({
          where: { id, ...userScope(authUserOrg), platformRole: "NONE" },
          data: { deletedAt: new Date(), sessionVersion: { increment: 1 } },
        });
        const revoked = await db.refreshToken.deleteMany({
          where: { userId: id },
        });
        await revokeAuthenticationFactors(db, id);
        await auditService.recordInTransaction(db, {
          action: "delete.user.success",
          entity: "User",
          entityId: deleted.id,
          before: stripSecrets(current),
          after: { ...stripSecrets(deleted), sessionsRevoked: revoked.count },
        });
        return deleted;
      });
    } catch (error) {
      if (isPrismaError(error, "P2025"))
        throw new AppError(400, "User does not exist");

      throw error;
    }

    const safe = stripSecrets(user);

    await this.invalidateUserCache();

    return safe;
  },

  async restore(id: string, authUserOrg: string) {
    //check if existing and not deleted
    await this.getById(id, authUserOrg, { deleted: true });
    let user;
    try {
      user = await accessTransaction(async (db) => {
        await lockOrganization(db, authUserOrg);
        const current = await db.user.findFirst({
          where: {
            id,
            ...userScope(authUserOrg, { deleted: true }),
            platformRole: "NONE",
          },
        });
        if (!current) throw new AppError(404, "User not found");
        await enforceSeatLimit(db, authUserOrg, 1, { includePending: true });
        const restored = await db.user.update({
          where: {
            id,
            ...userScope(authUserOrg, { deleted: true }),
            platformRole: "NONE",
          },
          data: { deletedAt: null, sessionVersion: { increment: 1 } },
        });
        const revoked = await db.refreshToken.deleteMany({
          where: { userId: id },
        });
        await revokeAuthenticationFactors(db, id);
        await auditService.recordInTransaction(db, {
          action: "restore.user.success",
          entity: "User",
          entityId: restored.id,
          before: stripSecrets(current),
          after: { ...stripSecrets(restored), sessionsRevoked: revoked.count },
        });
        return restored;
      });
    } catch (error) {
      if (isPrismaError(error, "P2025"))
        throw new AppError(400, "User does not exist");
      throw error;
    }

    const safe = stripSecrets(user);

    await this.invalidateUserCache();

    return safe;
  },

  async listForPermissionManagement(organizationId: string) {
    if (!organizationId) throw new AppError(400, "Organization ID is required");
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        organizationId,
        role: { organizationId, deletedAt: null },
      },
      select: {
        ...authorizationSelect,
        organization: { select: { slug: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleName: user.role.name,
      organizationName: user.organization?.name ?? null,
      permissions: resolvePermissions(user).names,
    }));
  },
};

//work on user updating their password...
