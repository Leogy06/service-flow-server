import type { Prisma } from "@/generated/prisma/client";
import { requestContext } from "@/lib/requestContext";
import { AppError } from "@/utils/AppError";
import { invalidating } from "@/utils/module-cache";
import { tenantTransaction } from "@/utils/tenant-transaction";

type PlatformAuditInput = {
  action: string;
  entity: string;
  entityId: string;
  organizationId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  actorType?: "USER" | "SYSTEM_ADMIN" | "SYSTEM" | "OPERATOR";
};

// Failure to append an audit record rolls back the sensitive mutation.
export function recordPlatformAudit(
  db: Prisma.TransactionClient,
  input: PlatformAuditInput,
) {
  const ctx = requestContext.get();
  return db.auditLog.create({
    data: {
      scope: "PLATFORM",
      actorType: input.actorType ?? (ctx?.userId ? "SYSTEM_ADMIN" : "SYSTEM"),
      actorId: ctx?.userId ?? null,
      organizationId: input.organizationId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata: {
        ...(input.before === undefined ? {} : { before: input.before }),
        ...(input.after === undefined ? {} : { after: input.after }),
      },
      ipAddress: ctx?.ip ?? null,
      userAgent: ctx?.userAgent?.slice(0, 191) ?? null,
      requestId: ctx?.requestId?.slice(0, 191) ?? null,
    },
  });
}

// Every platform write affects dashboard activity, including CLI/background
// callers. Services invalidate any additional resource projections they change.
export function platformTransaction<T>(work: (db: Prisma.TransactionClient) => Promise<T>) {
  return invalidating("platformDashboard", () => tenantTransaction(work));
}

// All tenant seat and subscription mutations acquire the same tenant row lock.
export async function lockOrganization(
  db: Prisma.TransactionClient,
  id: string,
) {
  const rows = await db.$queryRaw<
    Array<{ id: string }>
  >`SELECT id FROM Organization WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw new AppError(404, "Organization not found");
}
