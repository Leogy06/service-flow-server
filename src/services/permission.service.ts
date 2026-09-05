import { prisma } from "@/lib/prisma.js";

export const permissionService = {
  async create({ name, description }) {
    const response = await prisma.permission.create({
      data: {
        name,
        description,
      },
    });

    return response;
  },
};
