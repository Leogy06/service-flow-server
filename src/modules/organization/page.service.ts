import { prisma } from "@/lib/prisma";
import { assertDemoActionAllowed } from "@/lib/demo-guard";
import { Prisma } from "@/generated/prisma/client";
import { auditService } from "@/modules/audit/audit.service";
import { tenantTransaction } from "@/utils/tenant-transaction";
import { AppError } from "@/utils/AppError";
import { DEFAULT_PRIMARY_COLOR, requireBrandingTenant } from "./branding.service";
import { emptyPageContent, pageContentSchema, pageUpdateSchema, publicationIssues, type PageUpdateInput } from "./page.schema";

export const organizationPageService = {
  async get() {
    const organizationId = requireBrandingTenant(true);
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId, status: "ACTIVE" },
      select: { slug: true, name: true, page: { select: { draft: true, publishedAt: true, updatedAt: true } } },
    });
    if (!organization) throw new AppError(404, "Organization not found");
    return {
      organizationId, slug: organization.slug, name: organization.name,
      content: organization.page ? pageContentSchema.parse(organization.page.draft) : emptyPageContent(),
      publishedAt: organization.page?.publishedAt ?? null,
      version: organization.page?.updatedAt.toISOString() ?? null,
    };
  },
  async update(input: PageUpdateInput) {
    const organizationId = requireBrandingTenant(true);
    // Validate again at the service boundary; no organization selector is accepted.
    const { content, publication, version } = pageUpdateSchema.parse({ body: input, query: {} }).body;
    if (publication === "publish") {
      const issues = publicationIssues(content);
      if (issues.length) throw new AppError(400, issues.join(". ") + ".");
    }
    await tenantTransaction(async (db) => {
      if (publication === "publish") await assertDemoActionAllowed(db, organizationId, "publish public business pages");
      const organization = await db.organization.findUnique({ where: { id: organizationId, status: "ACTIVE" }, select: { id: true } });
      if (!organization) throw new AppError(404, "Organization not found");
      const before = await db.organizationPage.findUnique({ where: { organizationId } });
      if ((before?.updatedAt.toISOString() ?? null) !== version) throw new AppError(409, "This page was changed by another editor. Reload the saved content before trying again.");
      const now = new Date(Math.max(Date.now(), (before?.updatedAt.getTime() ?? 0) + 1));
      const data = {
        draft: content,
        updatedAt: now,
        ...(publication === "publish" ? { published: content, publishedAt: now } : {}),
        ...(publication === "unpublish" ? { published: Prisma.DbNull, publishedAt: null } : {}),
      };
      await db.organizationPage.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
      await auditService.recordInTransaction(db, {
        action: `organization.page.${publication === "keep" ? "save" : publication}`,
        entity: "OrganizationPage", entityId: organizationId,
        // Record the operation without duplicating public contact details into audits.
        before: { published: !!before?.publishedAt, version: before?.updatedAt.toISOString() ?? null },
        after: { published: publication === "keep" ? !!before?.publishedAt : publication === "publish", version: now.toISOString() },
      });
    });
    return this.get();
  },
  async publicPage(slug: string) {
    // Availability and publication are live reads: unpublish/suspension takes effect immediately.
    // Explicit projection excludes draft content, tenant IDs, users and operational records.
    const organization = await prisma.organization.findUnique({
      where: { slug, status: "ACTIVE", isDemo: false },
      select: {
        name: true, slug: true, isDemo: true,
        settings: { select: { displayName: true, primaryColor: true, logoUrl: true } },
        page: { select: { published: true, publishedAt: true } },
      },
    });
    const parsed = pageContentSchema.safeParse(organization?.page?.published);
    if (organization?.isDemo || !organization?.page?.publishedAt || !parsed.success) throw new AppError(404, "Page not found");
    return {
      name: organization.settings?.displayName ?? organization.name,
      slug: organization.slug,
      primaryColor: organization.settings?.primaryColor ?? DEFAULT_PRIMARY_COLOR,
      logoUrl: organization.settings?.logoUrl ?? null,
      content: parsed.data,
    };
  },
};
