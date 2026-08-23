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

  list: async (page = 1, pageSize = 10, search = "") => {
    //pagination
    
    const organizationId = requestContext.getValue("organizationId");
    if (!organizationId) {
      return prisma.customer.findMany();
    }
    return prisma.customer.findMany({ where: { organizationId } });
  },
};
