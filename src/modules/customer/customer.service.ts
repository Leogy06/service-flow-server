import { prisma } from "@/lib/prisma.js";
import { auditService } from "@/modules/audit/audit.service.js";
import {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "./customer.schema.js";
import { AppError } from "@/utils/AppError.js";
import { requestContext } from "@/lib/requestContext.js";
import {
  DEFAULT_TTL_SECONDS,
  getOrSetCache,
  invalidateCache,
} from "@/utils/cache.js";

export const customerService = {
  async create(data: CreateCustomerInput) {
    const organizationId = requestContext.getValue("organizationId");
    if (!organizationId) {
      throw new AppError(422, "Organization not found");
    }

    const [existingEmail, existingMobileNumber] = await Promise.all([
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
    ]);

    if (existingMobileNumber)
      throw new AppError(409, "Mobile number already in use");
    if (existingEmail) throw new AppError(409, "Email already in use");

    const newCustomer = await prisma.customer.create({
      data: { ...data, organizationId },
    });

    void auditService.record({
      action: "create.customer.success",
      entity: "Customer",
      entityId: newCustomer.id,
      // before: null,
      after: JSON.stringify(newCustomer),
    });

    await invalidateCache(`cache:customers:list:${organizationId}:*`);

    return newCustomer;
  },

  //TODO: add deletedAt and caching
  async list(
    page = 1,
    pageSize = 10,
    search = "",
    sortOrder = "desc",
    sortBy = "createdAt",
  ) {
    const organizationId = requestContext.getValue("organizationId");

    if (!organizationId) {
      throw new Error("Organization context is required");
    }

    const skip = (page - 1) * pageSize;

    const where = {
      deletedAt: null,
      organizationId,

      ...(search
        ? {
            OR: [
              {
                firstName: {
                  contains: search,
                },
              },
              {
                lastName: {
                  contains: search,
                },
              },
              {
                email: {
                  contains: search,
                },
              },
              {
                phoneNumber: {
                  contains: search,
                },
              },
            ],
          }
        : {}),
    };

    const cacheKey = `cache:customers:list:${organizationId}:${page}:${pageSize}:${sortBy}:${sortOrder}:${search}`;

    const { customers, total } = await getOrSetCache(
      cacheKey,
      DEFAULT_TTL_SECONDS,
      async () => {
        const [customers, total] = await Promise.all([
          prisma.customer.findMany({
            skip,
            take: pageSize,
            where,
            orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }],
          }),
          prisma.customer.count({ where }),
        ]);
        return { customers, total };
      },
    );

    const totalPages = Math.ceil(total / pageSize);

    return {
      customers,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  },

  async get(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id, deletedAt: null },
    });
    return customer;
  },

  async update(id: string, data: UpdateCustomerInput) {
    const existingCustomer = await prisma.customer.findUnique({
      where: { id, deletedAt: null },
    });

    if (!existingCustomer) throw new AppError(404, "Customer not found");

    //check any duplications - email, phone number

    const [existingEmail, existingMobileNumber] = await Promise.all([
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
    ]);

    if (existingEmail && existingEmail.id !== id)
      throw new AppError(409, "Email already in use");

    if (existingMobileNumber && existingMobileNumber.id !== id)
      throw new AppError(409, "Mobile number already in use");

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data,
    });

    void auditService.record({
      action: "update.customer.success",
      entity: "Customer",
      entityId: id,
      before: JSON.stringify(existingCustomer),
      after: JSON.stringify(updatedCustomer),
    });

    await invalidateCache(
      `cache:customers:list:${existingCustomer.organizationId}:*`,
    );

    return updatedCustomer;
  },

  async delete(id: string) {
    const existingCustomer = await prisma.customer.findUnique({
      where: { id, deletedAt: null },
    });

    if (!existingCustomer) throw new AppError(404, "Customer not found");

    const deletedCustomer = await prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    void auditService.record({
      action: "delete.customer.success",
      entity: "Customer",
      entityId: id,
      before: JSON.stringify(existingCustomer),
      after: JSON.stringify(deletedCustomer),
    });

    await invalidateCache(
      `cache:customers:list:${existingCustomer.organizationId}:*`,
    );

    return deletedCustomer;
  },
};
