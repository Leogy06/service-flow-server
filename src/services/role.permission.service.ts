import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";

export const rolePermissionService = {
  list: async (roleId: string) => {
    const response = await prisma.rolePermission.findMany({
      where: {
        roleId,
        isActive: true,
      },
      select: {
        role: {
          select: {
            name: true,
          },
        },
        permission: {
          select: {
            name: true,
          },
        },
      },
    });

    return response.map((rp) => ({
      roleName: rp.role.name,
      permissionName: rp.permission.name,
    }));
  },

  create: async ({
    roleId,
    permissionId,
  }: {
    roleId: string;
    permissionId: string;
  }) => {
    //check if is already exist
    const isExist = await prisma.rolePermission.findFirst({
      where: {
        roleId,
        permissionId,
      },
    });

    if (isExist) {
      throw new AppError(409, "Permission already exist");
    }

    const response = await prisma.rolePermission.create({
      data: { roleId, permissionId },
    });

    return response;
  },

  async update() {
    
  }
};
