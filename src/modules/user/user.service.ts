import { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";
import {
  DEFAULT_TTL_SECONDS,
  getOrSetCache,
  invalidateCache,
} from "@/utils/cache.js";
import { hashedPassword } from "@/utils/bcrypPassword.js";
import { CreateUserInput } from "@/types/index.js";
import crypto from "node:crypto";
import { sendInviteEmail } from "@/lib/email/send-invite.js";
import { auditService } from "@/modules/audit/audit.service.js";
import { SetPasswordParams, SetPasswordSchema } from "./user.schema.js";

const DEFAULT_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

interface ListProps {
  select?: Prisma.UserSelect;
  page?: number;
  pageSize?: number;
  search?: string;
  sortOrder?: "asc" | "desc";
  sortBy?: string;
  organizationId: string;
}

const ALLOWED_SORT_FIELDS = ["createdAt", "firstName", "lastName", "email"];

export const userService = {
  async list({
    select = DEFAULT_USER_SELECT,
    page = 1,
    pageSize = 10,
    search = "",
    sortOrder = "desc",
    sortBy = "createdAt",
    organizationId,
  }: ListProps) {
    if (!ALLOWED_SORT_FIELDS.includes(sortBy)) sortBy = "createdAt";

    const cacheKey = `cache:users:list:${organizationId}:${JSON.stringify(select)}:${page}:${pageSize}:${search}:${sortOrder}:${sortBy}`;

    const where = {
      deletedAt: null,
      organizationId,
      OR: search
        ? [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ]
        : undefined,
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

  async getById(id: string, select: Prisma.UserSelect = DEFAULT_USER_SELECT) {
    const cacheKey = `cache:user:byId:${id}:${JSON.stringify(select)}`;
    const user = await getOrSetCache(cacheKey, DEFAULT_TTL_SECONDS, () =>
      prisma.user.findUnique({ where: { id, deletedAt: null }, select }),
    );

    if (!user) throw new AppError(404, "User not founddd");

    return user;
  },

  async invalidateUserCache(userId?: string) {
    await invalidateCache("cache:users:list*"); //invalidate all users list cache keys

    if (userId) await invalidateCache(`cache:user:byId:${userId}*`); //invalidate specific user cache key
  },

  async validateCreateInput(input: CreateUserInput) {
    const [isEmailExist, isPhoneExist] = await Promise.all([
      prisma.user.findUnique({ where: { email: input.email } }),
      prisma.user.findUnique({ where: { phone: input.phone as string } }),
    ]);
    if (isEmailExist) throw new AppError(409, "Email already in use");
    if (isPhoneExist) throw new AppError(409, "Phone already in use");

    const [organization, role] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: input.organizationId },
      }),
      prisma.role.findFirst({
        where: {
          id: input.roleId,
          organizationId: input.organizationId,
        },
      }),
    ]);
    if (!organization) throw new AppError(404, "Organization not found");
    if (!role) throw new AppError(404, "Role not found");

    return { organization, role };
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

  async setPassword(input: SetPasswordSchema, params: SetPasswordParams) {
    //find user by email
    //check status if still pending - not set password
    //check token if expired - not set password
    const user = await prisma.user.findUnique({
      where: {
        email: params.email,
        inviteToken: params.token,
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
      where: { id: user.id },
      data: { password },
    });

    void auditService.record({
      action: "set.password.success",
      entity: "User",
      entityId: user.id,
      after: updatedUser,
    });

    return updatedUser;
  },

  async update(id: string, input: Prisma.UserUpdateInput) {
    //check if already deleted
    const existing = await this.getById(id);
    if (!existing || existing.deletedAt)
      throw new AppError(404, "User not found");

    const user = await prisma.user.update({ where: { id }, data: input });
    await this.invalidateUserCache(id);

    return user;
  },

  async delete(id: string) {
    //check if existing and deleted
    const existing = await this.getById(id);
    if (!existing || existing.deletedAt)
      throw new AppError(404, "User not found");

    const user = await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.invalidateUserCache(id);

    return user;
  },

  async restore(id: string) {
    //check if existing and not deleted
    const existing = await this.getById(id);
    if (!existing || !existing.deletedAt)
      throw new AppError(404, "User not found");

    const user = await prisma.user.update({
      where: { id },
      data: { deletedAt: null },
    });
    await this.invalidateUserCache(id);

    return user;
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
