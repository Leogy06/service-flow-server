import { prisma } from "@/lib/prisma";
import { UserCreateInput } from "../types";
import { AppError } from "@/utils/AppError";
import { auditService } from "@/modules/audit/audit.service";
import { hashedPassword } from "@/utils/bcrypPassword";
import { stripSecrets } from "@/utils/user-utils/stripSecrets.js";
import { accessTransaction, requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";

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
    await requirePlatformAuthority();
    const validatedInput = await this.validate(input);

    const newSystemAdmin = await accessTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const role = await db.role.findFirst({ where: { id: input.roleId, organizationId: input.organizationId ?? null }, select: { id: true } });
      if (!role) throw new AppError(404, "Role not found");
      return db.user.create({ data: { ...validatedInput, status: "ACTIVE" } });
    });
    const safe = stripSecrets(newSystemAdmin);

    void auditService.record({
      action: "CREATE",
      entity: "User",
      entityId: newSystemAdmin.id,
      after: safe,
    });

    return safe;
  },
};
