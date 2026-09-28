import { Prisma, UserStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import {
  DEFAULT_TTL_SECONDS,
  getOrSetCache,
  invalidateCache,
} from "@/utils/cache";
import { hashedPassword } from "@/utils/bcrypPassword";
import { CreateUserInput } from "@/types/index";
import crypto from "node:crypto";
import { sendInviteEmail } from "@/lib/email/send-invite";
import { auditService } from "@/modules/audit/audit.service";
import { SetPasswordParams, SetPasswordSchema } from "./user.schema";
import { UserUpdateInput } from "./types";
import { userScope } from "@/utils/user-utils/user-scope";
import { isPrismaError } from "@/utils/errorHelper";
import { stripSecrets } from "@/utils/user-utils/stripSecrets";

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
} satisfies Prisma.UserSelect;

interface ListProps {
  select?: Prisma.UserSelect;
  page?: number;
  pageSize?: number;
  search?: string;
  sortOrder?: "asc" | "desc";
  sortBy?: string;
  organizationId: string;
  status: "active" | "pending" | null;
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

    const cacheKey = `cache:user:byId:${organizationId}:${id}:${deleted}:${JSON.stringify(select)}`;

    const user = await getOrSetCache(cacheKey, DEFAULT_TTL_SECONDS, () =>
      prisma.user.findUnique({
        where: { id, ...userScope(organizationId, { deleted }) },
        select,
      }),
    );

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
    roleId,
    deleted,
  }: ListProps) {
    if (!organizationId) throw new AppError(400, "Organization ID is required");
    if (!ALLOWED_SORT_FIELDS.includes(sortBy)) sortBy = "createdAt";

    const cacheKey = `cache:users:list:${organizationId}:${JSON.stringify(select)}:${page}:${pageSize}:${search}:${sortOrder}:${sortBy}:${status ?? ""}:${roleId ?? ""}:${deleted ?? ""}`;

    const where = {
      organizationId,
      OR: search
        ? [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ]
        : undefined,
      deletedAt: deleted ? { not: null } : null,
      ...(status === "active" ? { status: UserStatus.ACTIVE } : {}),
      ...(status === "pending" ? { status: UserStatus.PENDING } : {}),
      ...(roleId ? { roleId } : {}),
    };

    const { users, total } = await getOrSetCache(
      cacheKey,
      DEFAULT_TTL_SECONDS,
      async () => {
        const [users, total] = await Promise.all([
          prisma.user.findMany({
            where,
            select,
            orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.user.count({
            where,
          }),
        ]);
        return { users, total };
      },
    );

    const totalPages = Math.ceil(total / pageSize);

    return {
      users,
      pagination: {
        total,
        totalPages,
        page,
        pageSize,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  },

  async invalidateUserCache(userId?: string) {
    try {
      await invalidateCache("cache:users:list*");
      if (userId) await invalidateCache(`cache:user:byId:*:${userId}:*`);
    } catch (err) {
      console.error("cache invalidation failed:", err);
      throw err;
    }
  },

  async validateCreateInput(input: CreateUserInput) {
    const [isEmailExist, isPhoneExist] = await Promise.all([
      prisma.user.findUnique({ where: { email: input.email } }),
      prisma.user.findUnique({ where: { phone: input.phone as string } }),
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
        },
      });
      if (!role) throw new AppError(404, "Role not found");
    }
    return input;
  },

  async createDirect(input: CreateUserInput) {
    //check email duplication and phone
    await this.validateCreateInput(input);

    const password = await hashedPassword(input.password!);

    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        middleName: input.middleName,
        suffix: input.suffix,
        email: input.email,
        phone: input.phone,
        password,
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

    await this.invalidateUserCache();

    return user;
  },

  async createWithInvite(input: CreateUserInput) {
    await this.validateCreateInput(input);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const inviteTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        middleName: input.middleName,
        suffix: input.suffix,
        email: input.email,
        phone: input.phone,
        password: null,
        status: "PENDING",
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

    void auditService.record({
      action: "create.user.success",
      entity: "User",
      entityId: user.id,
      after: user,
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

    return user;
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

  async setPassword(input: SetPasswordSchema, params: SetPasswordParams) {
    //find user by email
    //check status if still pending - not set password
    //check token if expired - not set password
    const user = await prisma.user.findUnique({
      where: {
        email: params.email,
        inviteToken: params.token,
        deletedAt: null,
      },
    });

    if (!user) throw new AppError(404, "User not found");
    if (user.status !== "PENDING")
      throw new AppError(400, "User is not pending");
    if (user.inviteTokenExpiry === null || user.inviteTokenExpiry < new Date())
      throw new AppError(400, "Invite token is expired or invalid");

    //check if password and confirm password match
    if (input.password !== input.confirmPassword)
      throw new AppError(400, "Password and confirm password do not match");

    const password = await hashedPassword(input.password!);

    const updatedUser = await prisma.user.update({
      where: { id: user.id, deletedAt: null },
      data: { password },
    });

    if (!updatedUser) throw new AppError(404, "User not found");

    void auditService.record({
      action: "set.password.success",
      entity: "User",
      entityId: user.id,
      after: updatedUser,
    });

    return updatedUser;
  },

  async update(
    id: string,
    input: UserUpdateInput,
    authUserOrg: string,
  ) {
    const existing = await this.getById(id, authUserOrg); // 404 if missing, deleted, other org

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
      user = await prisma.user.update({
        where: { id, ...userScope(authUserOrg) },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          middleName: input.middleName,
          suffix: input.suffix,
          email: input.email,
          phone: input.phone,
        },
      });
    } catch (error) {
      if (isPrismaError(error, "P2025"))
        throw new AppError(404, "User not found");
      if (isPrismaError(error, "P2002"))
        throw new AppError(409, "Email or phone already in use");
      throw error;
    }

    const safe = stripSecrets(user);

    void auditService
      .record({
        action: "update.user.success",
        entity: "User",
        entityId: user.id,
        before: existing,
        after: safe,
      })
      .catch((err) => console.error("audit failed:", err));

    await this.invalidateUserCache(id);
    return safe;
  },

  async delete(id: string, authUserOrg: string, actorId: string) {
    if (actorId === id) {
      throw new AppError(400, "You cannot delete your own account.");
    }

    const existing = await this.getById(id, authUserOrg);

    let user;

    try {
      user = await prisma.user.update({
        where: { id, ...userScope(authUserOrg) },
        data: { deletedAt: new Date() },
      });
    } catch (error) {
      if (isPrismaError(error, "P2025"))
        throw new AppError(400, "User does not exist");

      throw error;
    }

    const safe = stripSecrets(user);

    void auditService.record({
      action: "delete.user.success",
      entity: "User",
      entityId: user.id,
      before: JSON.stringify(existing),
      after: JSON.stringify(safe),
    });

    await this.invalidateUserCache(id);

    return safe;
  },

  async restore(id: string, authUserOrg: string) {
    //check if existing and not deleted
    const existing = await this.getById(id, authUserOrg, {deleted:true});
    let user;
    try {
      user = await prisma.user.update({
        where: { id, ...userScope(authUserOrg, {deleted:true}) },
        data: { deletedAt: null },
      });
    } catch(error) {
      if(isPrismaError(error, "P2025"))
        throw new AppError(400, "User does not exist");
      throw error;
    }

    const safe = stripSecrets(user);

    void auditService.record({
      action: "restore.user.success",
      entity: "User",
      entityId: user.id,
      before: JSON.stringify(existing),
      after: JSON.stringify(safe),
    }).catch((err) => console.error("audit failed:", err));

    await this.invalidateUserCache(id);
    
    return safe;
  },

  async listForPermissionManagement(organizationId: string) {
    if (!organizationId) throw new AppError(400, "Organization ID is required");

    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        organizationId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: {
          select: {
            name: true,
            permissions: {
              select: {
                permission: {
                  select: { name: true },
                },
              },
            },
          },
        },
        userPermissions: {
          select: {
            permission: {
              select: { name: true },
            },
          },
        },
        organization: {
          select: { name: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return users.map((user) => {
      const rolePermissions =
        user.role?.permissions?.map((rp) => rp.permission.name) || [];
      const extraPermissions =
        user.userPermissions?.map((up) => up.permission.name) || [];
      const permissions = Array.from(
        new Set([...rolePermissions, ...extraPermissions]),
      );

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roleName: user.role?.name ?? null,
        organizationName: user.organization?.name ?? null,
        permissions,
      };
    });
  },
};

//work on user updating their password...
