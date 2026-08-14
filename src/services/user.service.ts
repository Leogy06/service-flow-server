import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";

export const userService = {
  async list() {
    return prisma.user.findMany({ orderBy: { createdAt: "desc" } });
  },

  async getById(id: number) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError(404, "User not found");
    return user;
  },

  async create(data: { email: string; name: string }) {
    return prisma.user.create({ data });
  },
};
