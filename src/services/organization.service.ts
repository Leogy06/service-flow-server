import { prisma } from "@/lib/prisma.js";
import { Prisma } from "@/generated/prisma/client.js";
import { auditService } from "./audit.service.js";

export const organizationService = {
  async create(data: Prisma.OrganizationCreateInput) {
    const newOrg = await prisma.organization.create({ data });

    void auditService.record({
      action: "CREATE",
      entity: "Organization",
      entityId: newOrg.id,
      before: data as Prisma.InputJsonValue,
      after: newOrg,
    });
    return newOrg;
  },



  async list() {
    return await prisma.organization.findMany();
  },
};
