import { prisma } from "@/lib/prisma";
import { auditService } from "@/modules/audit/audit.service";
import type { CustomerListInput, UpdateCustomerInput } from "./customer.schema";
import { isDemoCustomerPhone } from "./customer.schema";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/utils/AppError";
import { isPrismaError } from "@/utils/errorHelper";
import { requestContext } from "@/lib/requestContext";
import { cachedRead, invalidateModuleCache } from "@/utils/module-cache";
import { CreateCustomerInput } from "./types";
import { tenantTransaction } from "@/utils/tenant-transaction";

async function validateDemoCustomerPhone(db: Prisma.TransactionClient, organizationId: string, phoneNumber?: string) {
  if (!phoneNumber || !isDemoCustomerPhone(phoneNumber)) return;
  // Reserved sample contacts stay editable without admitting foreign numbers to real businesses.
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { isDemo: true } });
  if (!organization) throw new AppError(404, "Organization not found");
  if (!organization.isDemo) throw new AppError(400, "Please enter a valid Philippine mobile number");
}

async function checkCustomerConflicts(
  db: Prisma.TransactionClient,
  organizationId: string,
  data: UpdateCustomerInput,
  id?: string,
) {
  // Archived identifiers stay reserved within this organization only.
  for (const [field, label] of [["email", "Email"], ["phoneNumber", "Mobile number"], ["name", "Customer name"]] as const) {
    if (data[field] === undefined) continue;
    const existing = await db.customer.findFirst({
      where: { organizationId, [field]: data[field] },
      select: { id: true },
    });
    if (existing && existing.id !== id) throw new AppError(409, `${label} already in use`);
  }
}

function customerOrganization() {
  const organizationId = requestContext.getValue("organizationId");
  if (!organizationId)
    throw new AppError(422, "Organization context is required");
  return organizationId;
}

export const customerService = {
  async create(data: CreateCustomerInput) {
    const organizationId = customerOrganization();

    const newCustomer = await tenantTransaction(async db => {
      await validateDemoCustomerPhone(db, organizationId, data.phoneNumber);
      await checkCustomerConflicts(db, organizationId, data);
      const customer = await db.customer.create({
        data: {
          name: data.name,
          email: data.email,
          phoneNumber: data.phoneNumber,
          address: data.address,
          notes: data.notes,
          organizationId,
        },
      });

      await auditService.recordInTransaction(db, {
        action: "create.customer.success",
        entity: "Customer",
        entityId: customer.id,
        after: JSON.stringify(customer),
      });
      return customer;
    });

    await invalidateModuleCache("customers");

    return newCustomer;
  },

  async list(
    page = 1,
    pageSize = 10,
    search = "",
    sortOrder: CustomerListInput["query"]["sortOrder"] = "desc",
    sortBy: CustomerListInput["query"]["sortBy"] = "createdAt",
    filter: CustomerListInput["query"]["filter"] = "all",
    deleted = false,
  ) {
    const organizationId = customerOrganization();
    const conditions: Prisma.CustomerWhereInput[] = [];
    const words = search.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      conditions.push({
        OR: ["name", "email", "phoneNumber", "address"].map((field) => ({
          [field]: { contains: word },
        })),
      });
    }
    if (filter === "missing_address")
      conditions.push({ OR: [{ address: null }, { address: "" }] });
    if (filter === "with_notes")
      conditions.push({ notes: { not: null } }, { notes: { not: "" } });

    const where: Prisma.CustomerWhereInput = {
      deletedAt: deleted ? { not: null } : null,
      organizationId,
      ...(conditions.length ? { AND: conditions } : {}),
    };

    const { customers, total, currentPage, totalPages } = await cachedRead(
      "customers", "list", { page, pageSize, search, sortOrder, sortBy, filter, deleted },
      async () => {
        return prisma.$transaction(
          async (db) => {
            const total = await db.customer.count({ where });
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const currentPage = Math.min(page, totalPages);
            const customers = await db.customer.findMany({
              skip: (currentPage - 1) * pageSize,
              take: pageSize,
              where,
              orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
            });
            return { customers, total, currentPage, totalPages };
          },
          { isolationLevel: "RepeatableRead" },
        );
      },
    );

    return {
      customers,
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
    };
  },

  async get(id: string) {
    const organizationId = customerOrganization();
    return cachedRead("customers", "get", id, async () => {
      const customer = await prisma.customer.findUnique({
        where: { id, organizationId, deletedAt: null },
      });
      if (!customer) throw new AppError(404, "Customer not found");
      return customer;
    });
  },

  async update(id: string, data: UpdateCustomerInput) {
    const organizationId = customerOrganization();
    const updatedCustomer = await tenantTransaction(async db => {
      const existingCustomer = await db.customer.findUnique({
        where: { id, organizationId, deletedAt: null },
      });

      if (!existingCustomer) throw new AppError(404, "Customer not found");

      await validateDemoCustomerPhone(db, organizationId, data.phoneNumber);
      await checkCustomerConflicts(db, organizationId, data, id);
      const customer = await db.customer.update({
        where: { id, organizationId, deletedAt: null },
        data,
      });

      await auditService.recordInTransaction(db, {
        action: "update.customer.success",
        entity: "Customer",
        entityId: id,
        before: JSON.stringify(existingCustomer),
        after: JSON.stringify(customer),
      });
      return customer;
    });

    await invalidateModuleCache("customers");

    return updatedCustomer;
  },

  async restore(id: string) {
    const organizationId = customerOrganization();
    const restoredCustomer = await tenantTransaction(async db => {
      const where = { id, organizationId, deletedAt: { not: null } };
      const existingCustomer = await db.customer.findUnique({ where });
      if (!existingCustomer) throw new AppError(404, "Customer not found");

      let restored;
      try {
        restored = await db.customer.update({
          where,
          data: { deletedAt: null },
        });
      } catch (error) {
        if (isPrismaError(error, "P2025"))
          throw new AppError(404, "Customer not found");
        throw error;
      }

      await auditService.recordInTransaction(db, {
        action: "restore.customer.success",
        entity: "Customer",
        entityId: id,
        before: JSON.stringify(existingCustomer),
        after: JSON.stringify(restored),
      });
      return restored;
    });
    await invalidateModuleCache("customers");
    return restoredCustomer;
  },

  async delete(id: string) {
    const organizationId = customerOrganization();
    const deletedCustomer = await tenantTransaction(async db => {
      const existingCustomer = await db.customer.findUnique({
        where: { id, organizationId, deletedAt: null },
      });

      if (!existingCustomer) throw new AppError(404, "Customer not found");

      const customer = await db.customer.update({
        where: { id, organizationId, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      await auditService.recordInTransaction(db, {
        action: "delete.customer.success",
        entity: "Customer",
        entityId: id,
        before: JSON.stringify(existingCustomer),
        after: JSON.stringify(customer),
      });
      return customer;
    });

    await invalidateModuleCache("customers");

    return deletedCustomer;
  },
};
