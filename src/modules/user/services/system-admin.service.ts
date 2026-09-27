import { prisma } from "@/lib/prisma";
import { UserCreateInput } from "../types";
import { AppError } from "@/utils/AppError";
import { auditService } from "@/modules/audit/audit.service";

export const systemAdminService = {
  async validate(input: UserCreateInput) {
    //check if phone number
    if (input.phone) {
      const existing = await prisma.user.findUnique({
        where: { phone: input.phone },
      });
      if (existing) throw new AppError(422, "Phone already in use");
    }

    if (input.organizationId) {
      const organization = await prisma.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!organization) throw new AppError(422, "Organization not found");
    }

    const isEmailExist = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (isEmailExist) throw new AppError(422, "Email already in use");
  },
  async create(input: UserCreateInput) {
    await this.validate(input);

    const newSystemAdmin = await prisma.user.create({
      data: input,
    });

    void auditService.record({
      action: "CREATE",
      entity: "User",
      entityId: newSystemAdmin.id,
      after: newSystemAdmin,
    });

    return newSystemAdmin;
  },
};
