import { prisma } from "@/lib/prisma";
import { UserCreateInput } from "../types";
import { AppError } from "@/utils/AppError";
import { hashedPassword } from "@/utils/bcrypPassword";
import { stripSecrets } from "@/utils/user-utils/stripSecrets.js";
import { accessTransaction, requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
import { recordPlatformAudit } from "@/modules/system-admin/platform-audit.js";
import type { SystemAdminCreateInput } from "../schemas/system-admin.schema.js";

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
  async create(input: SystemAdminCreateInput) {
    await requirePlatformAuthority();
    const validatedInput = await this.validate(input);

    const newSystemAdmin = await accessTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const role = await db.role.findFirst({ where: { id: input.roleId, organizationId: null, deletedAt: null }, select: { id: true } });
      if (!role) throw new AppError(404, "Role not found");
      const user = await db.user.create({ data: {
        firstName: validatedInput.firstName, lastName: validatedInput.lastName, middleName: validatedInput.middleName,
        suffix: validatedInput.suffix, email: validatedInput.email, phone: validatedInput.phone, password: validatedInput.password,
        roleId: role.id, organizationId: null, platformRole: "NONE", status: "ACTIVE",
      } });
      await recordPlatformAudit(db, { action: "platform.ordinary-account.create", entity: "User", entityId: user.id,
        after: { id: user.id, platformRole: "NONE", roleId: role.id, reason: input.reason } });
      return user;
    });
    const safe = stripSecrets(newSystemAdmin);

    return safe;
  },
};
