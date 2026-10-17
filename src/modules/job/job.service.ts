import { cachedRead, invalidating } from "@/utils/module-cache";
import { randomUUID } from "node:crypto";
import { requestContext } from "@/lib/requestContext";
import { auditService } from "@/modules/audit/audit.service";
import { AppError } from "@/utils/AppError";
import {
  tenantOrganization,
  tenantTransaction,
  pagination,
} from "@/utils/tenant-transaction";
import type { Prisma, JobStatus } from "@/generated/prisma/client";
import type { CreateJob, UpdateJob, JobList, JobFilters } from "./job.schema";
import { checkJobTransition } from "./lifecycle";

const jobSelect = {
  id: true,
  referenceNumber: true,
  serviceRequestId: true,
  assignedStaffId: true,
  description: true,
  location: true,
  scheduledStart: true,
  scheduledEnd: true,
  status: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true } },
  serviceType: { select: { id: true, name: true, basePrice: true } },
  serviceRequest: {
    select: { id: true, referenceNumber: true, title: true, status: true },
  },
  assignedStaff: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.JobSelect;

async function openRequest(
  db: Prisma.TransactionClient,
  id: string,
  organizationId: string,
) {
  const row = await db.serviceRequest.findFirst({
    where: { id, organizationId },
  });
  if (!row) throw new AppError(404, "Service request not found");
  if (row.status === "COMPLETED" || row.status === "CANCELLED")
    throw new AppError(409, "Closed requests cannot have jobs changed");
  return row;
}
async function activeStaff(
  db: Prisma.TransactionClient,
  id: string,
  organizationId: string,
) {
  const staff = await db.user.findFirst({
    where: {
      id,
      organizationId,
      status: "ACTIVE",
      deletedAt: null,
      role: { organizationId, deletedAt: null },
    },
    select: { id: true },
  });
  if (!staff) throw new AppError(404, "Active staff member not found");
}
function jobScopeWhere(
  query: JobFilters,
  organizationId: string,
): Prisma.JobWhereInput {
  return {
    organizationId,
    serviceRequestId: query.serviceRequestId,
    ...(query.mine === "true"
      ? { assignedStaffId: requestContext.getValue("userId") }
      : {}),
    ...(query.billable === "true"
      ? {
          status: "COMPLETED",
          invoice: null,
          AND: [
            {
              OR: [
                { serviceRequestId: null },
                { serviceRequest: { organizationId, status: "COMPLETED" } },
              ],
            },
          ],
        }
      : {}),
  };
}

export const jobService = {
  async filters(query: JobFilters) {
    const organizationId = tenantOrganization();
    const where = jobScopeWhere(query, organizationId);
    return cachedRead("jobs", "filters", query, async () => {
      return tenantTransaction(async (db) => {
        // Choices cover this entire view, independent of pagination and column filters.
        const [groups, customers, serviceTypes, staff, unassigned] =
          await Promise.all([
            db.job.groupBy({ by: ["status"], where, _count: { _all: true } }),
            db.customer.findMany({
              where: { organizationId, jobs: { some: where } },
              select: { id: true, name: true },
              orderBy: [{ name: "asc" }, { id: "asc" }],
            }),
            db.serviceType.findMany({
              where: { organizationId, jobs: { some: where } },
              select: { id: true, name: true },
              orderBy: [{ name: "asc" }, { id: "asc" }],
            }),
            db.user.findMany({
              where: { organizationId, jobs: { some: where } },
              select: { id: true, firstName: true, lastName: true },
              orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
            }),
            db.job.count({ where: { AND: [where, { assignedStaffId: null }] } }),
          ]);
        const byStatus: Record<JobStatus, number> = {
          ASSIGNED: 0,
          IN_PROGRESS: 0,
          COMPLETED: 0,
          CANCELLED: 0,
        };
        for (const group of groups) byStatus[group.status] = group._count._all;
        return {
          counts: {
            total: groups.reduce((total, group) => total + group._count._all, 0),
            byStatus,
          },
          filters: {
            customers,
            serviceTypes,
            staff,
            hasUnassigned: unassigned > 0,
          },
        };
      });
    });
  },
  async list(query: JobList) {
    const organizationId = tenantOrganization();
    const scope = jobScopeWhere(query, organizationId);
    const where: Prisma.JobWhereInput = {
      organizationId,
      ...(query.billable !== "true" ? { status: query.status } : {}),
      customerId: query.customerId,
      serviceTypeId: query.serviceTypeId,
      // Intersect with 'mine' rather than letting a staff filter replace it.
      AND: [
        scope,
        ...(query.assignedStaffId
          ? [
              {
                assignedStaffId:
                  query.assignedStaffId === "unassigned"
                    ? null
                    : query.assignedStaffId,
              },
            ]
          : []),
      ],
      ...(query.search
        ? {
            OR: [
              { referenceNumber: { contains: query.search } },
              {
                customer: { organizationId, name: { contains: query.search } },
              },
              {
                serviceType: {
                  organizationId,
                  name: { contains: query.search },
                },
              },
              {
                serviceRequest: {
                  organizationId,
                  referenceNumber: { contains: query.search },
                },
              },
            ],
          }
        : {}),
    };
    return cachedRead("jobs", "list", query, async () => {
      return tenantTransaction(async (db) => {
        const meta = pagination(
          query.page,
          query.pageSize,
          await db.job.count({ where }),
        );
        const jobs = await db.job.findMany({
          where,
          select: jobSelect,
          skip: (meta.page - 1) * meta.pageSize,
          take: meta.pageSize,
          orderBy: [{ createdAt: query.sortOrder }, { id: "asc" }],
        });
        return { jobs, pagination: meta };
      });
    });
  },
  async staff(query: { page: number; pageSize: number; search: string }) {
    const organizationId = tenantOrganization();
    const where: Prisma.UserWhereInput = {
      organizationId,
      status: "ACTIVE",
      deletedAt: null,
      role: { organizationId, deletedAt: null },
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
            ],
          }
        : {}),
    };
    return cachedRead("jobs", "staff", query, async () => {
      return tenantTransaction(async (db) => {
        const meta = pagination(
          query.page,
          query.pageSize,
          await db.user.count({ where }),
        );
        const staff = await db.user.findMany({
          where,
          select: { id: true, firstName: true, lastName: true },
          skip: (meta.page - 1) * meta.pageSize,
          take: meta.pageSize,
          orderBy: [{ firstName: "asc" }, { id: "asc" }],
        });
        return { staff, pagination: meta };
      });
    });
  },
  async get(id: string) {
    const organizationId = tenantOrganization();
    return cachedRead("jobs", "get", id, async () => {
      return tenantTransaction(async (db) => {
        const job = await db.job.findFirst({
          where: { id, organizationId },
          select: {
            ...jobSelect,
            internalNotes: true,
            statusHistory: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                fromStatus: true,
                toStatus: true,
                note: true,
                createdAt: true,
                changedBy: { select: { firstName: true, lastName: true } },
              },
            },
          },
        });
        if (!job) throw new AppError(404, "Job not found");
        return job;
      });
    });
  },
  async create(data: CreateJob) {
    const organizationId = tenantOrganization();
    return invalidating("jobs", () => tenantTransaction(async (db) => {
      const request = await openRequest(
        db,
        data.serviceRequestId,
        organizationId,
      );
      if (
        !(await db.customer.findFirst({
          where: { id: request.customerId, organizationId, deletedAt: null },
        }))
      )
        throw new AppError(404, "Customer not found");
      if (
        !(await db.serviceType.findFirst({
          where: { id: request.serviceTypeId, organizationId },
        }))
      )
        throw new AppError(404, "Service type not found");
      await activeStaff(db, data.assignedStaffId, organizationId);
      const job = await db.job.create({
        data: {
          ...data,
          organizationId,
          customerId: request.customerId,
          serviceTypeId: request.serviceTypeId,
          referenceNumber: `JOB-${randomUUID().toUpperCase()}`,
          statusHistory: {
            create: {
              toStatus: "ASSIGNED",
              changedById: requestContext.getValue("userId"),
              note: "Job created and assigned",
            },
          },
        },
        select: jobSelect,
      });
      await auditService.recordInTransaction(db, {
        action: "create.job.success",
        entity: "Job",
        entityId: job.id,
        after: {
          serviceRequestId: request.id,
          assignedStaffId: data.assignedStaffId,
        },
      });
      return job;
    }));
  },
  async update(id: string, data: UpdateJob) {
    const organizationId = tenantOrganization();
    return invalidating("jobs", () => tenantTransaction(async (db) => {
      const job = await db.job.findFirst({ where: { id, organizationId } });
      if (!job) throw new AppError(404, "Job not found");
      if (job.serviceRequestId)
        await openRequest(db, job.serviceRequestId, organizationId);
      if (job.status === "COMPLETED" || job.status === "CANCELLED")
        throw new AppError(409, "Closed jobs cannot be edited");
      if (data.assignedStaffId !== undefined)
        await activeStaff(db, data.assignedStaffId, organizationId);
      const start =
        data.scheduledStart === undefined
          ? job.scheduledStart
          : data.scheduledStart;
      const end =
        data.scheduledEnd === undefined ? job.scheduledEnd : data.scheduledEnd;
      if (end && (!start || end < start))
        throw new AppError(400, "Scheduled end must follow scheduled start");
      const updated = await db.job.update({
        where: { id, organizationId },
        data,
        select: jobSelect,
      });
      await auditService.recordInTransaction(db, {
        action:
          data.assignedStaffId && data.assignedStaffId !== job.assignedStaffId
            ? "assign.job.success"
            : "update.job.success",
        entity: "Job",
        entityId: id,
        before: { assignedStaffId: job.assignedStaffId },
        after: {
          assignedStaffId: updated.assignedStaffId,
          changedFields: Object.keys(data),
        },
      });
      return updated;
    }));
  },
  async status(id: string, status: JobStatus, note: string) {
    const organizationId = tenantOrganization();
    return invalidating("jobs", () => tenantTransaction(async (db) => {
      const job = await db.job.findFirst({ where: { id, organizationId } });
      if (!job) throw new AppError(404, "Job not found");
      const request = job.serviceRequestId
        ? await openRequest(db, job.serviceRequestId, organizationId)
        : null;
      checkJobTransition(job.status, status);
      if (status === "IN_PROGRESS") {
        if (!job.assignedStaffId)
          throw new AppError(409, "Assign staff before starting the job");
        await activeStaff(db, job.assignedStaffId, organizationId);
      }
      const updated = await db.job.update({
        where: { id, organizationId },
        data: {
          status,
          ...(status === "IN_PROGRESS" ? { startedAt: new Date() } : {}),
          ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
          statusHistory: {
            create: {
              fromStatus: job.status,
              toStatus: status,
              note,
              changedById: requestContext.getValue("userId"),
            },
          },
        },
        select: jobSelect,
      });
      if (status === "IN_PROGRESS" && request?.status === "PENDING") {
        await db.serviceRequest.update({
          where: { id: request.id, organizationId },
          data: { status: "IN_PROGRESS" },
        });
        await auditService.recordInTransaction(db, {
          action: "status_change.service_request.success",
          entity: "ServiceRequest",
          entityId: request.id,
          before: { status: "PENDING" },
          after: { status: "IN_PROGRESS", jobId: id },
        });
      }
      await auditService.recordInTransaction(db, {
        action: "status_change.job.success",
        entity: "Job",
        entityId: id,
        before: { status: job.status },
        after: { status },
      });
      // Request completion remains explicit, even after the last job completes.
      return status === "IN_PROGRESS" && request?.status === "PENDING"
        ? db.job.findFirstOrThrow({
            where: { id, organizationId },
            select: jobSelect,
          })
        : updated;
    }));
  },
};
