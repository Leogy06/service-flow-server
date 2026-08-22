import { AuditAction } from "@/generated/prisma/enums.js";
import { prisma } from "@/lib/prisma.js";
import { requestContext } from "@/lib/requestContext.js";
import type { Prisma } from "@/generated/prisma/client.js";
import { logger } from "@/lib/logger.js";

type RecordAuditInput = {
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

export const auditService = {
  async record(input: RecordAuditInput) {
    const ctx = requestContext.get();

    // Fire-and-forget: audit writes should never block or fail the main request.
    //audit log wont save if it fails even the main request will succeed
    prisma.auditLog
      .create({
        data: {
          actorId: ctx?.userId,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId,
          ipAddress: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
          metadata: {
            before: input.before,
            after: input.after,
          },
        },
      })
      .catch((err) => {
        logger.error({ err }, "Failed to record audit log");
      });
  },
};
