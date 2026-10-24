import { createHash } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { createCustomerSchema } from "../../src/modules/customer/customer.schema.js";

const CUSTOMER_NAMES = [
  "Miguel Santos", "Isabella Reyes", "Gabriel Cruz", "Sofia Garcia",
  "Daniel Mendoza", "Andrea Torres", "Rafael Flores", "Camille Ramos",
  "Joshua Bautista", "Bianca Villanueva", "Adrian Navarro", "Patricia Aquino",
  "Carlo Fernandez", "Nicole Castillo", "Marco Dela Cruz", "Angela Santiago",
  "Paolo Rivera", "Jasmine Gonzales", "Luis Mercado", "Christine Lim",
];

const ADDRESSES = [
  "Quezon City, Metro Manila", "Makati City, Metro Manila",
  "Pasig City, Metro Manila", "Taguig City, Metro Manila",
  "Manila, Metro Manila", "Cebu City, Cebu", "Davao City, Davao del Sur",
  "Bacolod City, Negros Occidental",
];

// Stable IDs make this additional batch safe to rerun without changing existing customers.
export async function seedCustomers(prisma: PrismaClient) {
  return prisma.$transaction(async (db) => {
    const organizations = await db.organization.findMany({
      select: { id: true, name: true, slug: true }, orderBy: { slug: "asc" },
    });
    const results = [];

    for (const organization of organizations) {
      const token = createHash("sha256").update(organization.id).digest("hex").slice(0, 16);
      const before = await db.customer.count({ where: { organizationId: organization.id, deletedAt: null } });
      let created = 0;

      for (const [index, name] of CUSTOMER_NAMES.entries()) {
        const id = `seed-customer-${token}-${index + 1}`;
        const existing = await db.customer.findUnique({ where: { id }, select: { organizationId: true } });
        if (existing) {
          if (existing.organizationId !== organization.id) throw new Error("Seed customer organization mismatch");
          continue;
        }

        // Archived phone numbers stay reserved within their tenant.
        const phoneSeed = Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 12), 16);
        let phoneNumber: string | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          const candidate = `09${String((phoneSeed + attempt) % 1_000_000_000).padStart(9, "0")}`;
          if (!await db.customer.findFirst({ where: { organizationId: organization.id, phoneNumber: candidate }, select: { id: true } })) {
            phoneNumber = candidate;
            break;
          }
        }
        if (!phoneNumber) throw new Error("Could not allocate a unique seed customer phone number");

        const data = createCustomerSchema.parse({ body: {
          name: `${name} (${organization.slug.slice(0, 40)}-${token.slice(0, 8)})`,
          email: `${name.toLowerCase().replace(/ /g, ".")}.${token}@example.test`,
          phoneNumber,
          address: index % 5 === 0 ? undefined : `${100 + index} Sample Street, ${ADDRESSES[index % ADDRESSES.length]}`,
          notes: index % 4 === 0 ? "Sample customer for development and testing." : undefined,
        } }).body;

        const customer = await db.customer.create({ data: { id, organizationId: organization.id, ...data } });
        await db.auditLog.create({ data: {
          actorId: null, organizationId: organization.id,
          action: "create.customer.success", entity: "Customer", entityId: customer.id,
          metadata: { source: "prisma/seed-customers.ts" },
        } });
        created++;
      }

      const after = await db.customer.count({ where: { organizationId: organization.id, deletedAt: null } });
      if (after !== before + created) throw new Error("Seed customer count verification failed");
      results.push({ organizationId: organization.id, organization: organization.name, created, before, after });
    }

    return results;
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });
}
