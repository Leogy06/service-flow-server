import { prisma } from "@/lib/prisma";
import { auditService } from "@/modules/audit/audit.service";
import type { CustomerListInput, UpdateCustomerInput } from "./customer.schema";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/utils/AppError";
import { isPrismaError } from "@/utils/errorHelper";
import { requestContext } from "@/lib/requestContext";
import { cachedRead, invalidateModuleCache } from "@/utils/module-cache";
import { CreateCustomerInput } from "./types";

function customerOrganization() {
  const organizationId = requestContext.getValue("organizationId");
  if (!organizationId)
    throw new AppError(422, "Organization context is required");
  return organizationId;
}

export const customerService = {
  async create(data: CreateCustomerInput) {
    const organizationId = customerOrganization();

    const [existingEmail, existingMobileNumber, existingName] =
      await Promise.all([
        prisma.customer.findUnique({
          where: {
            email: data.email,
          },
        }),
        prisma.customer.findUnique({
          where: {
            phoneNumber: data.phoneNumber,
          },
        }),
        prisma.customer.findUnique({ where: { name: data.name } }),
      ]);

    if (existingMobileNumber)
      throw new AppError(409, "Mobile number already in use");
    if (existingEmail) throw new AppError(409, "Email already in use");
    if (existingName) throw new AppError(409, "Customer name already in use");

    const newCustomer = await prisma.customer.create({
      data: {
        name: data.name,
        email: data.email,
        phoneNumber: data.phoneNumber,
        address: data.address,
        notes: data.notes,
        organizationId,
      },
    });

    void auditService.record({
      action: "create.customer.success",
      entity: "Customer",
      entityId: newCustomer.id,
      // before: null,
      after: JSON.stringify(newCustomer),
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
    const existingCustomer = await prisma.customer.findUnique({
      where: { id, organizationId, deletedAt: null },
    });

    if (!existingCustomer) throw new AppError(404, "Customer not found");

    const [existingEmail, existingMobileNumber, existingName] =
      await Promise.all([
        data.email === undefined
          ? null
          : prisma.customer.findUnique({
              where: {
                email: data.email,
              },
            }),
        data.phoneNumber === undefined
          ? null
          : prisma.customer.findUnique({
              where: {
                phoneNumber: data.phoneNumber,
              },
            }),
        data.name === undefined
          ? null
          : prisma.customer.findUnique({ where: { name: data.name } }),
      ]);

    if (existingEmail && existingEmail.id !== id)
      throw new AppError(409, "Email already in use");

    if (existingMobileNumber && existingMobileNumber.id !== id)
      throw new AppError(409, "Mobile number already in use");
    if (existingName && existingName.id !== id)
      throw new AppError(409, "Customer name already in use");

    const updatedCustomer = await prisma.customer.update({
      where: { id, organizationId, deletedAt: null },
      data,
    });

    void auditService.record({
      action: "update.customer.success",
      entity: "Customer",
      entityId: id,
      before: JSON.stringify(existingCustomer),
      after: JSON.stringify(updatedCustomer),
    });

    await invalidateModuleCache("customers");

    return updatedCustomer;
  },

  async restore(id: string) {
    const organizationId = customerOrganization();
    const where = { id, organizationId, deletedAt: { not: null } };
    const existingCustomer = await prisma.customer.findUnique({ where });
    if (!existingCustomer) throw new AppError(404, "Customer not found");

    let restoredCustomer;
    try {
      restoredCustomer = await prisma.customer.update({
        where,
        data: { deletedAt: null },
      });
    } catch (error) {
      if (isPrismaError(error, "P2025"))
        throw new AppError(404, "Customer not found");
      throw error;
    }

    void auditService.record({
      action: "restore.customer.success",
      entity: "Customer",
      entityId: id,
      before: JSON.stringify(existingCustomer),
      after: JSON.stringify(restoredCustomer),
    });
    await invalidateModuleCache("customers");
    return restoredCustomer;
  },

  async delete(id: string) {
    const organizationId = customerOrganization();
    const existingCustomer = await prisma.customer.findUnique({
      where: { id, organizationId, deletedAt: null },
    });

    if (!existingCustomer) throw new AppError(404, "Customer not found");

    const deletedCustomer = await prisma.customer.update({
      where: { id, organizationId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    void auditService.record({
      action: "delete.customer.success",
      entity: "Customer",
      entityId: id,
      before: JSON.stringify(existingCustomer),
      after: JSON.stringify(deletedCustomer),
    });

    await invalidateModuleCache("customers");

    return deletedCustomer;
  },
};
