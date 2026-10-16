import { prisma } from "@/lib/prisma.js";
import { AppError } from "@/utils/AppError.js";
import { requestContext } from "@/lib/requestContext.js";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
import { platformTransaction, recordPlatformAudit } from "@/modules/system-admin/platform-audit.js";
import type { OrganizationInput } from "./organization.schema.js";

export const organizationService = {
  async create(input: OrganizationInput) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const organization = await db.organization.create({ data: { name: input.name, slug: input.slug } });
      await recordPlatformAudit(db, { action: "platform.organization.create", entity: "Organization", entityId: organization.id,
        organizationId: organization.id, after: { id: organization.id, name: organization.name, slug: organization.slug, reason: input.reason } });
      return organization;
    });
  },

  async list() {
    await requirePlatformAuthority();
    return await prisma.organization.findMany();
  },

  async getById(organizationId: string) {
    if (!organizationId) throw new AppError(422, "Organization id is missing");
    if (requestContext.getValue("organizationId") !== organizationId) await requirePlatformAuthority();

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId, status: "ACTIVE" },
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

    // console.log("Slug: ", cleanSlug);

    const organization = await prisma.organization.findUnique({
      where: { slug: cleanSlug, status: "ACTIVE" },
      select: { name: true, slug: true },
    });
    if (!organization) throw new AppError(404, "Organization not found");

    return organization;
  },
};
