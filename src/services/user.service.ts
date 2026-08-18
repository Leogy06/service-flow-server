import { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { DEFAULT_TTL_SECONDS, getOrSetCache } from "@/utils/cache.js";

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
    const cacheKey = `cache:user:get:${id}:${JSON.stringify(select)}`;
    const user = await getOrSetCache(cacheKey, DEFAULT_TTL_SECONDS, () =>
      prisma.user.findUnique({ where: { id }, select }),
    );

    if (!user) throw new AppError(404, "User not found");

    return user;
  },

  // async create(data: { email: string; name: string }) {
  //   return prisma.user.create({ data });
  // },
};
