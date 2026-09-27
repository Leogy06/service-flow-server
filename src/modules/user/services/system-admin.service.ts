import { prisma } from "@/lib/prisma";
import { UserCreateInput } from "../types";
import { AppError } from "@/utils/AppError";
import { auditService } from "@/modules/audit/audit.service";
import { hashedPassword } from "@/utils/bcrypPassword";

export const systemAdminService = {
  async validate(input: UserCreateInput) {
    let validatedInput = input;
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

    if (input.password) {
      //hash password
      validatedInput = {
        ...input,
        password: await hashedPassword(input.password),
      };
    }

    const isEmailExist = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (isEmailExist) throw new AppError(422, "Email already in use");

    return validatedInput;
  },
  async create(input: UserCreateInput) {
    const validatedInput = await this.validate(input);

    const newSystemAdmin = await prisma.user.create({
      data: { ...validatedInput, status: "ACTIVE" },
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
