import { prisma } from "@/lib/prisma.js";

export const permissionService = {
  rolePermissions: async (roleId: string) => {
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

    const formattedResponse = response.map((rp) => ({
      roleName: rp.role.name,
      permissionName: rp.permission.name,
    }));

    const length = formattedResponse.length;
    return { length, formattedResponse };
  },
};
