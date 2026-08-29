import { prisma } from "@/lib/prisma.js";
import { Prisma } from "@/generated/prisma/client.js";
import { auditService } from "./audit.service.js";
import { AppError } from "@/utils/AppError.js";

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

  async getById(organizationId: string) {
    if (!organizationId) throw new AppError(422, "Organization id is missing");

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        slug: true,
      },
    });
    if (!organization) throw new AppError(404, "Organization not found");
    return organization;
  },

  async checkSlug(slug: string) {
    const cleanSlug = slug?.trim().toLowerCase();
    if (!cleanSlug) throw new AppError(422, "Organization slug is missing");

    console.log("Slug: ", cleanSlug);

    const organization = await prisma.organization.findUnique({
      where: { slug: cleanSlug },
    });
    if (!organization) throw new AppError(404, "Organization not found");

    return organization;
  },
};
