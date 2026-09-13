import { prisma } from "@/lib/prisma.js";

export const roleService = {
  async list(organizationId: string) {
    return await prisma.role.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  },
};
