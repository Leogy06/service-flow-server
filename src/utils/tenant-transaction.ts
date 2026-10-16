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

export function isTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  if (code === "P2034" || [1020, 1205, 1213, "1020", "1205", "1213"].includes(code as number | string)) return true;
  // The Prisma MariaDB adapter can expose native serialization failures as an
  // unknown-request error rather than P2034. Limit matching to known lock codes.
  return "message" in error && typeof error.message === "string" && /Database error\. Code: `(?:1020|1205|1213)`/.test(error.message);
}

export async function tenantTransaction<T>(work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (isTransactionConflict(error) && attempt < 2) continue;
      if (isTransactionConflict(error)) throw new AppError(409, "The record changed concurrently. Please retry");
      if (code === "P2002") throw new AppError(409, "A record with this name or reference already exists", "DUPLICATE_RECORD");
      throw error;
    }
  }
}
