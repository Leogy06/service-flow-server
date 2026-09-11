import { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import {
  DEFAULT_TTL_SECONDS,
  getOrSetCache,
  invalidateCache,
} from "@/utils/cache.js";
import bcrypt from "bcryptjs";
import { hashedPassword } from "@/utils/bcrypPassword.js";

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

  async create(input: Prisma.UserCreateInput) {
    //check email duplication and phone
    const [isEmailExist, isPhoneExist] = await Promise.all([
      prisma.user.findUnique({ where: { email: input.email } }),
      prisma.user.findUnique({ where: { phone: input.phone as string } }),
    ])

    if(isEmailExist) throw new AppError(409, "Email already in use");
    if(isPhoneExist) throw new AppError(409, "Phone already in use");

    //hash
    input.password = await hashedPassword(input.password);
   
    const user = await prisma.user.create({ data: input });
    await this.invalidateUserCache();

    return user;
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
