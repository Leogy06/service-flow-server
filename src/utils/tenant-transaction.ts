import { prisma } from "@/lib/prisma.js";
import { requestContext } from "@/lib/requestContext.js";
import { AppError } from "@/utils/AppError.js";
import type { Prisma } from "@/generated/prisma/client.js";

export function tenantOrganization() {
  const id = requestContext.getValue("organizationId");
  if (!id) throw new AppError(403, "An organization session is required");
  return id;
}

export function pagination(page: number, pageSize: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  return { page: current, pageSize, total, totalPages, hasNextPage: current < totalPages, hasPreviousPage: current > 1 };
}

export async function tenantTransaction<T>(work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "P2034" && attempt < 2) continue;
      if (code === "P2034") throw new AppError(409, "The record changed concurrently. Please retry");
      if (code === "P2002") throw new AppError(409, "A record with this name or reference already exists", "DUPLICATE_RECORD");
      throw error;
    }
  }
}
