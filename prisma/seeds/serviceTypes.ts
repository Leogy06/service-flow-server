import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { createTypeInput, type CreateType } from "../../src/modules/service-request/service-request.schema.js";

// Sample PHP prices for a small starter catalog, rather than real service quotations.
const CATALOGS = [
  {
    industry: "plumbing", pattern: /\b(?:plumbing|plumber)\b/,
    services: [
      { name: "Leak Repair", description: "Repair a minor water leak in a pipe or fitting.", basePrice: 800 },
      { name: "Drain Unclogging", description: "Clear a blocked sink or bathroom drain.", basePrice: 1000 },
      { name: "Faucet Replacement", description: "Replace a damaged or leaking faucet.", basePrice: 600 },
      { name: "Toilet Repair", description: "Fix a running toilet or a faulty flush mechanism.", basePrice: 800 },
      { name: "Pipe Repair", description: "Repair a damaged section of a water pipe.", basePrice: 1200 },
    ],
  },
  {
    industry: "electrical", pattern: /\b(?:electrical|electrician)\b/,
    services: [
      { name: "Electrical Inspection", description: "Check basic wiring, outlets, and switches for faults.", basePrice: 700 },
      { name: "Outlet Repair", description: "Repair or replace a faulty electrical outlet.", basePrice: 500 },
      { name: "Switch Replacement", description: "Replace a damaged light switch.", basePrice: 400 },
      { name: "Light Fixture Installation", description: "Install a light fixture at an existing wiring point.", basePrice: 700 },
      { name: "Circuit Breaker Replacement", description: "Replace a faulty circuit breaker.", basePrice: 1000 },
    ],
  },
  {
    industry: "hvac", pattern: /\b(?:hvac|aircon|air\s*conditioning|air\s*conditioner)\b/,
    services: [
      { name: "Aircon Cleaning", description: "Clean the filters and accessible parts of an air conditioner.", basePrice: 800 },
      { name: "Aircon Repair", description: "Diagnose and repair a basic air conditioner fault.", basePrice: 1500 },
      { name: "Aircon Installation", description: "Install a standard air conditioning unit.", basePrice: 3000 },
      { name: "Air Filter Replacement", description: "Replace a worn or dirty HVAC air filter.", basePrice: 500 },
      { name: "HVAC Maintenance", description: "Perform routine cleaning and checks on an HVAC unit.", basePrice: 1200 },
    ],
  },
] satisfies { industry: string; pattern: RegExp; services: CreateType[] }[];

export function serviceTypeCatalog(organization: { name: string; slug: string }) {
  const identity = `${organization.name} ${organization.slug}`.toLowerCase().replace(/[-_]+/g, " ");
  const matches = CATALOGS.filter((catalog) => catalog.pattern.test(identity));
  // Unknown or mixed industries require an explicit catalog instead of guessing.
  return matches.length === 1 ? matches[0] : undefined;
}

export async function seedServiceTypes(prisma: PrismaClient) {
  return prisma.$transaction(async (db) => {
    const organizations = await db.organization.findMany({
      select: { id: true, name: true, slug: true }, orderBy: { slug: "asc" },
    });
    const results = [];
    for (const organization of organizations) {
      const catalog = serviceTypeCatalog(organization);
      if (!catalog) {
        results.push({ organizationId: organization.id, organization: organization.name,
          industry: null, created: 0, existing: 0 });
        continue;
      }
      let created = 0;
      let existing = 0;
      for (const service of catalog.services) {
        const data = createTypeInput.parse({ body: service }).body;
        const row = await db.serviceType.findUnique({
          where: { organizationId_name: { organizationId: organization.id, name: data.name } },
          select: { id: true },
        });
        if (row) {
          existing++;
          continue;
        }
        const serviceType = await db.serviceType.create({ data: { ...data, organizationId: organization.id } });
        await db.auditLog.create({ data: {
          actorId: null, organizationId: organization.id,
          action: "create.service_type.success", entity: "ServiceType", entityId: serviceType.id,
          metadata: { source: "prisma/seed-service-types.ts", industry: catalog.industry },
        } });
        created++;
      }
      results.push({ organizationId: organization.id, organization: organization.name,
        industry: catalog.industry, created, existing });
    }
    return results;
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });
}
