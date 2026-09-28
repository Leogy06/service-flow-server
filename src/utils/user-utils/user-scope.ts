import { Prisma } from "@/generated/prisma/client";

export const userScope = (
  organizationId: string,
  opts: { deleted?: boolean } = {},
) =>
  ({
    organizationId,
    deletedAt: opts.deleted ? { not: null } : null,
  }) satisfies Prisma.UserWhereInput;
