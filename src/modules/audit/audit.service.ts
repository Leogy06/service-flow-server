import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/requestContext";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { AppError } from "@/utils/AppError";
import { isTenantAdminName } from "@/modules/role/tenant-access-policy";
import type { ListAuditLogsQuery } from "./audit.schema";

type RecordAuditInput = {
  action: string;
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

export const auditService = {
  async list(query: ListAuditLogsQuery) {
    // authenticate reloads the user's active role and organization from the database.
    // Audit access belongs exclusively to tenant admins, regardless of staff grants.
    const ctx = requestContext.get();
    if (
      !ctx?.userId ||
      !ctx.organizationId ||
      !ctx.role ||
      !isTenantAdminName(ctx.role)
    ) {
      throw new AppError(403, "Tenant administration is required");
    }
    const organizationId = ctx.organizationId;
    const where: Prisma.AuditLogWhereInput = {
      scope: "TENANT",
      organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.search
        ? {
            AND: query.search
              .split(/\s+/)
              .map((word) => ({
                OR: [
                  { action: { contains: word } },
                  { entity: { contains: word } },
                  { entityId: { contains: word } },
                  {
                    actor: {
                      is: {
                        organizationId,
                        OR: [
                          { firstName: { contains: word } },
                          { lastName: { contains: word } },
                        ],
                      },
                    },
                  },
                ],
              })),
          }
        : {}),
    };
    return prisma.$transaction(
      async (db) => {
        const total = await db.auditLog.count({ where });
        const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
        const page = Math.min(query.page, totalPages);
        const logs = await db.auditLog.findMany({
          where,
          select: {
            id: true,
            action: true,
            entity: true,
            entityId: true,
            createdAt: true,
            actor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                organizationId: true,
              },
            },
          },
          orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
          skip: (page - 1) * query.pageSize,
          take: query.pageSize,
        });
        // Options include the tenant's full history, independent of the current page or filters.
        const [actions, entities] = await Promise.all([
          db.auditLog.groupBy({
            by: ["action"],
            where: { organizationId, scope: "TENANT" },
            orderBy: { action: "asc" },
          }),
          db.auditLog.groupBy({
            by: ["entity"],
            where: { organizationId, scope: "TENANT" },
            orderBy: { entity: "asc" },
          }),
        ]);
        return {
          filters: {
            actions: actions.map((row) => row.action),
            entities: entities.map((row) => row.entity),
          },
          logs: logs.map(({ actor, ...log }) => ({
            ...log,
            // A historical actor may now belong to a different tenant.
            actor:
              actor?.organizationId === organizationId
                ? {
                    id: actor.id,
                    firstName: actor.firstName,
                    lastName: actor.lastName,
                  }
                : null,
          })),
          pagination: {
            page,
            pageSize: query.pageSize,
            total,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  },
  // Access mutations await this inside their transaction: audit failure rolls back access changes.
  async recordInTransaction(
    db: Prisma.TransactionClient,
    input: RecordAuditInput,
  ) {
    const ctx = requestContext.get();
    return db.auditLog.create({
      data: {
        actorId: ctx?.userId,
        organizationId: ctx?.organizationId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        ipAddress: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
        metadata: { before: input.before, after: input.after },
      },
    });
  },
  async record(input: RecordAuditInput) {
    const ctx = requestContext.get();

    // Fire-and-forget: audit writes should never block or fail the main request.
    //audit log wont save if it fails even the main request will succeed
    prisma.auditLog
      .create({
        data: {
          actorId: ctx?.userId, //the one who did the action
          action: input.action,
          entity: input.entity,
          entityId: input.entityId,
          ipAddress: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
          organizationId: ctx?.organizationId ?? null,
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
