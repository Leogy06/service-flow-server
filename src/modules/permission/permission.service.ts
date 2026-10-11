import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";
import { requireTenantAdmin, requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";

interface CreatePermissionInput {
  name: string;
  description: string;
}

export const permissionService = {
  async listGrantable() {
    const actor = await requireTenantAdmin(prisma, [PERMISSIONS.ROLE_READ, PERMISSIONS.USER_READ, PERMISSIONS.USER_CREATE, PERMISSIONS.USER_UPDATE]);
    return prisma.permission.findMany({
      where: { name: { in: actor.grantable }, OR: [{ organizationId: null }, { organizationId: actor.organizationId }] },
      select: { id: true, name: true, description: true }, orderBy: { name: "asc" },
    });
  },
  async validateInput(input: CreatePermissionInput) {
    const existing = await prisma.permission.findUnique({
      where: { name: input.name },
    });
    if (existing) throw new AppError(409, "Name already in use");
  },

  async create({ name, description }: { name: string; description: string }) {
    await requirePlatformAuthority();
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
