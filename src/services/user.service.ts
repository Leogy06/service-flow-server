import { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import {
  DEFAULT_TTL_SECONDS,
  getOrSetCache,
  invalidateCache,
} from "@/utils/cache.js";

const DEFAULT_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

export const userService = {
  async list(select: Prisma.UserSelect = DEFAULT_USER_SELECT) {
    const cacheKey = `cache:users:list${JSON.stringify(select)}`;

    return getOrSetCache(cacheKey, DEFAULT_TTL_SECONDS, () =>
      prisma.user.findMany({
        select,
        orderBy: {
          createdAt: "desc",
        },
      }),
    );
  },

  async getById(id: string, select: Prisma.UserSelect = DEFAULT_USER_SELECT) {
    const cacheKey = `cache:user:byId:${id}:${JSON.stringify(select)}`;
    const user = await getOrSetCache(cacheKey, DEFAULT_TTL_SECONDS, () =>
      prisma.user.findUnique({ where: { id }, select }),
    );

    if (!user) throw new AppError(404, "User not found");

    return user;
  },

  async invalidateUserCache(userId?: string) {
    await invalidateCache("cache:users:list*"); //invalidate all users list cache keys

    if (userId) await invalidateCache(`cache:user:byId:${userId}*`); //invalidate specific user cache key
  },

  async create(input: Prisma.UserCreateInput) {
    const user = await prisma.user.create({ data: input });
    await this.invalidateUserCache()

    return user;
  },

  async update(id: string, input: Prisma.UserUpdateInput) {
    const user = await prisma.user.update({ where: { id }, data: input });
    await this.invalidateUserCache(id)

    return user;
  },

  async deleteUser(id: string) {
    await prisma.user.delete({ where: { id } });
    await this.invalidateUserCache(id)
  }
};
