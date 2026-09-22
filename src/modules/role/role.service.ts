import { prisma } from "@/lib/prisma.js";
import { auditService } from "@/modules/audit/audit.service";
import { CreateRoleInput } from "./types";
import { AppError } from "@/utils/AppError";

export const roleService = {
  async list(organizationId: string) {
    if (!organizationId) throw new AppError(422, "Organization id is missing");
    return await prisma.role.findMany({
      where: {
        organizationId,
      },
    });
  },

  async create(input: CreateRoleInput) {
    const newRole = await prisma.role.create({
      data: input,
    });

    void auditService.record({
      action: "CREATE",
      entity: "Role",
      entityId: newRole.id,
      after: newRole,
    });

    return newRole;
  },
};
