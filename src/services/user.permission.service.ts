import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";

export const userPermissionService = {
  async updateUserPermissions(
    userId: string,
    permissionIds: string[],
    organizationId?: string,
  ) {

    if(!organizationId) throw new AppError(400, "Organization id is required");

    return prisma.$transaction(async (tx) => {
      // Make sure user belongs to current organization
      const user = await tx.user.findFirst({
        where: {
          id: userId,
          organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      // Check if all permissions exist
      const permissions = await tx.permission.findMany({
        where: {
          id: {
            in: permissionIds,
          },
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (permissions.length !== new Set(permissionIds).size) {
        throw new AppError(
          400,
          `One or more permissions not found ids: ${permissionIds.length} perms: ${permissions.length}`,
        );
      }

      // Existing direct user permissions
      const existing = await tx.userPermission.findMany({
        where: {
          userId,
        },
        select: {
          id: true,
          permissionId: true,
          isActive: true,
        },
      });

      const requested = new Set(permissionIds);

      // Revoke removed permissions
      for (const userPermission of existing) {
        if (!requested.has(userPermission.permissionId)) {
          if (userPermission.isActive) {
            await tx.userPermission.update({
              where: {
                id: userPermission.id,
              },
              data: {
                isActive: false,
              },
            });
          }
        }
      }

      // Grant / reactivate requested permissions
      for (const permissionId of permissionIds) {
        const existingPermission = existing.find(
          (up) => up.permissionId === permissionId,
        );

        if (existingPermission) {
          if (!existingPermission.isActive) {
            await tx.userPermission.update({
              where: {
                id: existingPermission.id,
              },
              data: {
                isActive: true,
              },
            });
          }
        } else {
          await tx.userPermission.create({
            data: {
              userId,
              permissionId,
              isActive: true,
            },
          });
        }
      }

      // Return active direct permissions
      return tx.userPermission.findMany({
        where: {
          userId,
          isActive: true,
        },
        select: {
          id: true,
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
