import { cachedRead, invalidating } from "@/utils/module-cache";
import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/requestContext";
import { isTenantAdminName } from "@/modules/role/tenant-access-policy";
import { auditService } from "@/modules/audit/audit.service";
import { tenantTransaction } from "@/utils/tenant-transaction";
import { AppError } from "@/utils/AppError";
import { logger } from "@/lib/logger";
import type { Prisma, OrganizationSettings } from "@/generated/prisma/client";
import { brandingAssets, type BrandingAssetKind } from "./branding-assets";
import type { BrandingUpdateInput } from "./branding.schema";

export const DEFAULT_PRIMARY_COLOR = "#b91c1c";
export function requireBrandingTenant(admin = false) {
  const ctx = requestContext.get();
  if (!ctx?.userId || !ctx.organizationId) throw new AppError(403, "An organization session is required");
  if (admin && (!ctx.role || !isTenantAdminName(ctx.role))) throw new AppError(403, "Tenant administration is required");
  return ctx.organizationId;
}
function defaults(organizationId: string) {
  return { organizationId, primaryColor: DEFAULT_PRIMARY_COLOR, displayName: null, logoUrl: null, faviconUrl: null, createdAt: null, updatedAt: null };
}
function auditedSettings(row: OrganizationSettings | null) {
  return { primaryColor: row?.primaryColor ?? DEFAULT_PRIMARY_COLOR, displayName: row?.displayName ?? null, logoUrl: row?.logoUrl ?? null, faviconUrl: row?.faviconUrl ?? null };
}
async function activeOrganization(db: Prisma.TransactionClient, organizationId: string) {
  if (!await db.organization.findUnique({ where: { id: organizationId, status: "ACTIVE" }, select: { id: true } })) throw new AppError(404, "Organization not found");
}
type SettingsChanges = Partial<Pick<OrganizationSettings, "primaryColor" | "displayName" | "logoUrl" | "faviconUrl">>;
async function updateSettings(organizationId: string, data: SettingsChanges, action: string) {
  return invalidating("branding", () => tenantTransaction(async (db) => {
    await activeOrganization(db, organizationId);
    const before = await db.organizationSettings.findUnique({ where: { organizationId } });
    const settings = await db.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    await auditService.recordInTransaction(db, {
      action, entity: "OrganizationSettings", entityId: organizationId,
      before: auditedSettings(before), after: auditedSettings(settings),
    });
    return { settings, before };
  }));
}
async function removeUnusedAsset(url: string | null) {
  if (!url) return;
  // A path is removed only after commit and only if no current setting references it.
  try {
    const referenced = await prisma.organizationSettings.findFirst({ where: { OR: [{ logoUrl: url }, { faviconUrl: url }] }, select: { organizationId: true } });
    if (!referenced) await brandingAssets.remove(url);
  } catch { logger.warn("Unable to clean up an unused branding asset"); }
}

export const brandingService = {
  async get() {
    const organizationId = requireBrandingTenant();
    return cachedRead("branding", "get", [], async () => {
      const organization = await prisma.organization.findUnique({ where: { id: organizationId, status: "ACTIVE" }, select: { settings: true } });
      if (!organization) throw new AppError(404, "Organization not found");
      return organization.settings ?? defaults(organizationId);
    });
  },
  async update(input: BrandingUpdateInput) {
    const organizationId = requireBrandingTenant(true);
    const data = {
      ...(input.primaryColor !== undefined ? { primaryColor: input.primaryColor ?? DEFAULT_PRIMARY_COLOR } : {}),
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    };
    return (await updateSettings(organizationId, data, "organization.branding.update")).settings;
  },
  async upload(kind: BrandingAssetKind, data: Buffer, contentType: string) {
    const organizationId = requireBrandingTenant(true);
    const url = await brandingAssets.save(data, contentType, kind);
    let result;
    try {
      result = await updateSettings(organizationId, kind === "logo" ? { logoUrl: url } : { faviconUrl: url }, `organization.branding.${kind}.upload`);
    } catch (error) {
      await removeUnusedAsset(url);
      throw error;
    }
    await removeUnusedAsset(kind === "logo" ? result.before?.logoUrl ?? null : result.before?.faviconUrl ?? null);
    return result.settings;
  },
  async remove(kind: BrandingAssetKind) {
    const organizationId = requireBrandingTenant(true);
    const result = await updateSettings(organizationId, kind === "logo" ? { logoUrl: null } : { faviconUrl: null }, `organization.branding.${kind}.remove`);
    await removeUnusedAsset(kind === "logo" ? result.before?.logoUrl ?? null : result.before?.faviconUrl ?? null);
    return result.settings;
  },
  async asset(filename: string) {
    const url = brandingAssets.url(filename);
    const referenced = await prisma.organizationSettings.findFirst({ where: { organization: { status: "ACTIVE" }, OR: [{ logoUrl: url }, { faviconUrl: url }] }, select: { organizationId: true } });
    if (!referenced) throw new AppError(404, "Branding image not found");
    return brandingAssets.read(filename);
  },
};
