import { prisma } from "@/lib/prisma.js";
import { auditService } from "./audit.service.js";
import { requestContext } from "@/lib/requestContext.js";
import { CreateCustomerInput } from "@/schemas/customer.schema.js";
import { AppError } from "@/utils/AppError.js";

export const customerService = {
  create: async (data: CreateCustomerInput) => {
    const organizationId = requestContext.getValue("organizationId");

    if (!organizationId) {
      throw new AppError(422, "Organization not found");
    }

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
};
