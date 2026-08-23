import { prisma } from "@/lib/prisma.js";
import { auditService } from "./audit.service.js";
import { CreateCustomerInput } from "@/schemas/customer.schema.js";
import { AppError } from "@/utils/AppError.js";
import { requestContext } from "@/lib/requestContext.js";

export const customerService = {
  create: async (data: CreateCustomerInput) => {
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
      action: "CREATE",
      entity: "Customer",
      entityId: newCustomer.id,
      // before: null,
      after: newCustomer,
    });

    return newCustomer;
  },

  //TODO: add deletedAt and caching
  list: async (
    page = 1,
    pageSize = 10,
    search = "",
    sortOrder = "asc",
    sortBy = "createdAt",
  ) => {
    const organizationId = requestContext.getValue("organizationId");

    if (!organizationId) {
      throw new Error("Organization context is required");
    }

    const skip = (page - 1) * pageSize;

    const where = {
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

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        skip,
        take: pageSize,
        where,
        orderBy: [
          {
            [sortBy]: sortOrder,
          },
          {
            id: "asc",
          },
        ],
      }),

      prisma.customer.count({
        where,
      }),
    ]);

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
};
