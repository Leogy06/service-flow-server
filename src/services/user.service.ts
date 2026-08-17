import { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

const DEFAULT_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} satisfies Prisma.UserSelect;

export const userService = {
  async list(select: Prisma.UserSelect = DEFAULT_USER_SELECT) {
    return prisma.user.findMany({
      select,
      orderBy: { createdAt: "desc" },
    });
  },

  async getById(id: string, select: Prisma.UserSelect = DEFAULT_USER_SELECT) {
    const user = await prisma.user.findUnique({
      where: { id },
      select,
    });
    if (!user) throw new AppError(404, "User not found");
    return user;
  },

  // async create(data: { email: string; name: string }) {
  //   return prisma.user.create({ data });
  // },
};
