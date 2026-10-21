import { cachedRead, invalidating } from "@/utils/module-cache";
import { randomUUID } from "node:crypto";
import { auditService } from "@/modules/audit/audit.service";
import { AppError } from "@/utils/AppError";
import type { Prisma, ServiceRequestStatus } from "@/generated/prisma/client";
import type {
  CreateRequest,
  UpdateRequest,
  RequestList,
  CreateType,
  UpdateType,
  TypeList,
} from "./service-request.schema";
import { requestTransitions, validateTransition } from "./lifecycle";
import {
  tenantOrganization as organization,
  tenantTransaction as transaction,
  pagination,
} from "@/utils/tenant-transaction";
const requestSelect = {
  id: true,
  referenceNumber: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  customerId: true,
  serviceTypeId: true,
  customer: { select: { id: true, name: true } },
  serviceType: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.ServiceRequestSelect;
async function related(
  db: Prisma.TransactionClient,
  organizationId: string,
  customerId?: string,
  serviceTypeId?: string,
) {
  if (
    customerId &&
    !(await db.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
      select: { id: true },
    }))
  ) {
    throw new AppError(404, "Customer not found");
  }
  if (
    serviceTypeId &&
    !(await db.serviceType.findFirst({
      where: { id: serviceTypeId, organizationId, isActive: true },
      select: { id: true },
    }))
  ) {
    throw new AppError(404, "Available service type not found");
  }
}
async function existing(
  db: Prisma.TransactionClient,
  id: string,
  organizationId: string,
) {
  const row = await db.serviceRequest.findFirst({
    where: { id, organizationId },
  });
  if (!row) throw new AppError(404, "Service request not found");
  return row;
}
export const serviceRequestService = {
  async counts() {
    const organizationId = organization();
    return cachedRead("serviceRequests", "counts", {}, () => transaction(async (db) => {
      const groups = await db.serviceRequest.groupBy({
        by: ["status"], where: { organizationId }, _count: { _all: true },
      });
      const byStatus: Record<ServiceRequestStatus, number> = {
        PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0,
      };
      for (const group of groups) byStatus[group.status] = group._count._all;
      return {
        pending: byStatus.PENDING,
        inProgress: byStatus.IN_PROGRESS,
        byStatus,
        total: groups.reduce((total, group) => total + group._count._all, 0),
      };
    }));
  },
  async list(query: RequestList) {
    const organizationId = organization();
    const where: Prisma.ServiceRequestWhereInput = {
      organizationId,
      status: query.status,
      priority: query.priority,
      serviceTypeId: query.serviceTypeId,
      ...(query.search
        ? {
            OR: [
              { referenceNumber: { contains: query.search } },
              { title: { contains: query.search } },
              {
                customer: { organizationId, name: { contains: query.search } },
              },
            ],
          }
        : {}),
    };
    return cachedRead("serviceRequests", "list", query, async () => {
      return transaction(async (db) => {
        const total = await db.serviceRequest.count({ where });
        const meta = pagination(query.page, query.pageSize, total);
        const requests = await db.serviceRequest.findMany({
          where,
          select: requestSelect,
          skip: (meta.page - 1) * meta.pageSize,
          take: meta.pageSize,
          orderBy: [{ createdAt: query.sortOrder }, { id: "asc" }],
        });
        return { requests, pagination: meta };
      });
    });
  },
  async customers(query: { page: number; pageSize: number; search: string }) {
    const where = {
      organizationId: organization(),
      deletedAt: null,
      name: { contains: query.search },
    };
    return cachedRead("customers", "customers", query, async () => {
      return transaction(async (db) => {
        const meta = pagination(
          query.page,
          query.pageSize,
          await db.customer.count({ where }),
        );
        const customers = await db.customer.findMany({
          where,
          select: { id: true, name: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (meta.page - 1) * meta.pageSize,
          take: meta.pageSize,
        });
        return { customers, pagination: meta };
      });
    });
  },
  async get(id: string) {
    const organizationId = organization();
    return cachedRead("serviceRequests", "get", id, async () => {
      return transaction(async (db) => {
        await existing(db, id, organizationId);
        const request = await db.serviceRequest.findFirstOrThrow({
          where: { id, organizationId },
          select: {
            ...requestSelect,
            jobs: {
              where: { organizationId },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                referenceNumber: true,
                status: true,
                description: true,
                scheduledStart: true,
                completedAt: true,
              },
            },
          },
        });
        const activity = await db.auditLog.findMany({
          where: { organizationId, entity: "ServiceRequest", entityId: id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            action: true,
            createdAt: true,
            metadata: true,
          },
        });
        return {
          ...request,
          activity,
          allowedTransitions: requestTransitions[request.status],
        };
      });
    });
  },
  async create(data: CreateRequest) {
    const organizationId = organization();
    return invalidating("serviceRequests", () => transaction(async (db) => {
      await related(db, organizationId, data.customerId, data.serviceTypeId);
      const request = await db.serviceRequest.create({
        data: {
          ...data,
          organizationId,
          referenceNumber: `SR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().toUpperCase()}`,
        },
        select: requestSelect,
      });
      await auditService.recordInTransaction(db, {
        action: "create.service_request.success",
        entity: "ServiceRequest",
        entityId: request.id,
        after: { status: request.status },
      });
      return request;
    }));
  },
  async update(id: string, data: UpdateRequest) {
    const organizationId = organization();
    return invalidating("serviceRequests", () => transaction(async (db) => {
      const row = await existing(db, id, organizationId);
      if (["COMPLETED", "CANCELLED"].includes(row.status))
        throw new AppError(409, "Closed requests cannot be edited");
      const changesCustomer =
        data.customerId !== undefined && data.customerId !== row.customerId;
      const changesType =
        data.serviceTypeId !== undefined &&
        data.serviceTypeId !== row.serviceTypeId;
      if (
        (changesCustomer || changesType) &&
        (await db.job.count({
          where: { serviceRequestId: id, organizationId },
        }))
      ) {
        throw new AppError(
          409,
          "Customer and service type cannot change after jobs are linked",
        );
      }
      await related(
        db,
        organizationId,
        data.customerId,
        changesType ? data.serviceTypeId : undefined,
      );
      const request = await db.serviceRequest.update({
        where: { id, organizationId },
        data,
        select: requestSelect,
      });
      await auditService.recordInTransaction(db, {
        action: "update.service_request.success",
        entity: "ServiceRequest",
        entityId: id,
        after: { changedFields: Object.keys(data) },
      });
      return request;
    }));
  },
  async status(id: string, status: ServiceRequestStatus) {
    const organizationId = organization();
    return invalidating("serviceRequests", () => transaction(async (db) => {
      const row = await existing(db, id, organizationId);
      const jobs = await db.job.findMany({
        where: { serviceRequestId: id, organizationId },
        select: { status: true },
      });
      validateTransition(row.status, status, jobs);
      const request = await db.serviceRequest.update({
        where: { id, organizationId },
        data: { status },
        select: requestSelect,
      });
      await auditService.recordInTransaction(db, {
        action: "status_change.service_request.success",
        entity: "ServiceRequest",
        entityId: id,
        before: { status: row.status },
        after: { status },
      });
      return request;
    }));
  },
  async types(query: TypeList) {
    const where = {
      organizationId: organization(),
      name: { contains: query.search },
      ...(query.active !== "all"
        ? { isActive: query.active === "active" }
        : {}),
    };
    return cachedRead("serviceTypes", "types", query, async () => {
      return transaction(async (db) => {
        const meta = pagination(
          query.page,
          query.pageSize,
          await db.serviceType.count({ where }),
        );
        const serviceTypes = await db.serviceType.findMany({
          where,
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (meta.page - 1) * meta.pageSize,
          take: meta.pageSize,
        });
        return { serviceTypes, pagination: meta };
      });
    });
  },
  async createType(data: CreateType) {
    const organizationId = organization();
    return invalidating("serviceTypes", () => transaction(async (db) => {
      const row = await db.serviceType.create({
        data: { ...data, organizationId },
      });
      await auditService.recordInTransaction(db, {
        action: "create.service_type.success",
        entity: "ServiceType",
        entityId: row.id,
      });
      return row;
    }));
  },
  async updateType(id: string, data: UpdateType | { isActive: false }) {
    const organizationId = organization();
    return invalidating("serviceTypes", () => transaction(async (db) => {
      if (!(await db.serviceType.findFirst({ where: { id, organizationId } })))
        throw new AppError(404, "Service type not found");
      const row = await db.serviceType.update({
        where: { id, organizationId },
        data,
      });
      await auditService.recordInTransaction(db, {
        action:
          "isActive" in data
            ? "archive.service_type.success"
            : "update.service_type.success",
        entity: "ServiceType",
        entityId: id,
        after: { changedFields: Object.keys(data) },
      });
      return row;
    }));
  },
};
