import { prisma } from "@/lib/prisma.js";
import { auditService } from "../audit/audit.service";
import { CreateRoleInput } from "./types";

export const roleService = {
  async list(organizationId: string) {
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
