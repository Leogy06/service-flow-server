import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";

interface CreatePermissionInput {
  name: string;
  description: string;
}

export const permissionService = {
  async validateInput(input: CreatePermissionInput) {
    const existing = await prisma.permission.findUnique({
      where: { name: input.name },
    });
    if (existing) throw new AppError(409, "Name already in use");
  },

  async create({ name, description }: { name: string; description: string }) {
    await this.validateInput({ name, description });

    const response = await prisma.permission.create({
      data: {
        name,
        description,
      },
    });

    return response;
  },
};
