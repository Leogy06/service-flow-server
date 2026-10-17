import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import {
  requireTenantAdmin,
  requirePlatformAuthority,
} from "@/modules/role/tenant-access-policy";
import { PERMISSIONS } from "@/constants/permission.constants";
import {
  platformTransaction,
  recordPlatformAudit,
} from "@/modules/system-admin/platform-audit";
import type { CreatePermissionSchema } from "./permission.schema";

interface CreatePermissionInput {
  name: string;
  description: string;
}

export const permissionService = {
  async listGrantable() {
    const actor = await requireTenantAdmin(prisma, [
      PERMISSIONS.ROLE_READ,
      PERMISSIONS.USER_READ,
      PERMISSIONS.USER_CREATE,
      PERMISSIONS.USER_UPDATE,
    ]);
    return prisma.permission.findMany({
      where: {
        name: { in: actor.grantable },
        OR: [
          { organizationId: null },
          { organizationId: actor.organizationId },
        ],
      },
      select: { id: true, name: true, description: true },
      orderBy: { name: "asc" },
    });
  },
  async validateInput(input: CreatePermissionInput) {
    const existing = await prisma.permission.findUnique({
      where: { name: input.name },
    });
    if (existing) throw new AppError(409, "Name already in use");
  },

  async create(input: CreatePermissionSchema) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      if (await db.permission.findUnique({ where: { name: input.name } }))
        throw new AppError(409, "Name already in use");
      const permission = await db.permission.create({
        data: { name: input.name, description: input.description },
      });
      await recordPlatformAudit(db, {
        action: "platform.permission.create",
        entity: "Permission",
        entityId: permission.id,
        after: {
          id: permission.id,
          name: permission.name,
          description: permission.description,
          reason: input.reason,
        },
      });
      return permission;
    });
  },
};
