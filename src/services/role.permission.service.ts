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

  async update(
    roleId: string,
    permissionIds: string[],
    organizationId: string,
  ) {
    return prisma.$transaction(async (tx) => {
      const role = await tx.role.findFirst({
        where: {
          id: roleId,
          organizationId,
        },
        select: {
          id: true,
        },
      });

      if (!role) {
        throw new AppError(404, "Role not found");
      }

      //check if all permission exist
      const permissions = await tx.permission.findMany({
        where: {
          id: {
            in: permissionIds,
          },
          select: {
            id: true,
            name: true,
          },
        },
      });

      if (permissions.length !== permissionIds.length) {
        throw new AppError(400, "One or more permissions not found");
      }

      const existing = await tx.rolePermission.findMany({
        where: {
          roleId,
        },
        select: {
          id: true,
          permissionId: true,
          isActive: true,
        },
      });

      const requested = new Set(permissionIds);

      //revoke removed permissions
      for (const rolePermission of existing) {
        if (!requested.has(rolePermission.permissionId)) {
          await tx.rolePermission.update({
            where: {
              id: rolePermission.id,
            },
            data: {
              isActive: false,
            },
          });
        }
      }

      //grant access
      for (const permissionId of permissionIds) {
        const existingPermission = existing.find(
          (rp) => rp.permissionId === permissionId,
        );

        if (existingPermission) {
          if (!existingPermission.isActive) {
            await tx.rolePermission.update({
              where: {
                id: existingPermission.id,
              },
              data: {
                isActive: true,
              },
            });
          } else {
            await tx.rolePermission.create({
              data: {
                roleId,
                permissionId,
                isActive: true,
              },
            });
          }
        }
      }

      return tx.rolePermission.findMany({
        where: {
          roleId,
          isActive: true,
        },
        select: {
          permission: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    });
  },
};
