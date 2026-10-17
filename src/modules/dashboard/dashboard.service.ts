import { Prisma } from "@/generated/prisma/client";
import { requestContext } from "@/lib/requestContext";
import { PERMISSIONS as P } from "@/constants/permission.constants";
import { isTenantAdminName } from "@/modules/role/tenant-access-policy";
import { AppError } from "@/utils/AppError";
import { prisma } from "@/lib/prisma";
import { tenantOrganization } from "@/utils/tenant-transaction";
import { dashboardPeriods, dashboardTimeZone } from "./periods";

const jobSelect = {
  id: true,
  referenceNumber: true,
  description: true,
  location: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  completedAt: true,
  customer: { select: { name: true } },
  serviceType: { select: { name: true } },
  assignedStaff: {
    select: { firstName: true, lastName: true, organizationId: true },
  },
} satisfies Prisma.JobSelect;
const requestSelect = {
  id: true,
  referenceNumber: true,
  title: true,
  priority: true,
  customer: { select: { name: true } },
} satisfies Prisma.ServiceRequestSelect;

type Periods = ReturnType<typeof dashboardPeriods>;
const activeStatuses = ["ASSIGNED", "IN_PROGRESS"] as const;

async function jobsOverview(
  db: Prisma.TransactionClient,
  organizationId: string,
  staffId: string | undefined,
  now: Date,
  periods: Periods,
  canBill: boolean,
) {
  const base: Prisma.JobWhereInput = {
    organizationId,
    ...(staffId ? { assignedStaffId: staffId } : {}),
    customer: { organizationId },
    serviceType: { organizationId },
    OR: [{ serviceRequestId: null }, { serviceRequest: { organizationId } }],
  };
  const active: Prisma.JobWhereInput = {
    ...base,
    status: { in: [...activeStatuses] },
  };
  const overdue: Prisma.JobWhereInput = {
    ...active,
    AND: [
      {
        OR: [
          { scheduledEnd: { lt: now } },
          {
            status: "ASSIGNED",
            scheduledEnd: null,
            scheduledStart: { lt: periods.today },
          },
        ],
      },
    ],
  };
  const completed: Prisma.JobWhereInput = { ...base, status: "COMPLETED" };
  const [
    byStatus,
    overdueCount,
    todayCount,
    unscheduled,
    completedThisMonth,
    completedPreviousPeriod,
    completedToday,
    unassigned,
    readyToInvoice,
    weeklyCompletions,
    overdueJobs,
    recentCompletions,
  ] = await Promise.all([
    db.job.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    db.job.count({ where: overdue }),
    db.job.count({
      where: {
        ...active,
        scheduledStart: { gte: periods.today, lt: periods.tomorrow },
      },
    }),
    db.job.count({ where: { ...active, scheduledStart: null } }),
    db.job.count({
      where: {
        ...completed,
        completedAt: { gte: periods.monthStart, lt: now },
      },
    }),
    db.job.count({
      where: {
        ...completed,
        completedAt: { gte: periods.previousStart, lt: periods.previousEnd },
      },
    }),
    db.job.count({
      where: { ...completed, completedAt: { gte: periods.today, lt: now } },
    }),
    staffId
      ? Promise.resolve(0)
      : db.job.count({ where: { ...active, assignedStaffId: null } }),
    canBill
      ? db.job.count({
          where: {
            ...completed,
            invoice: null,
            AND: [
              {
                OR: [
                  { serviceRequestId: null },
                  { serviceRequest: { organizationId, status: "COMPLETED" } },
                ],
              },
            ],
          },
        })
      : Promise.resolve(null),
    Promise.all(
      periods.weeks.map(async (week) => ({
        label: week.label,
        count:
          week.end <= week.start
            ? 0
            : await db.job.count({
                where: {
                  ...completed,
                  completedAt: { gte: week.start, lt: week.end },
                },
              }),
      })),
    ),
    db.job.findMany({
      where: overdue,
      select: jobSelect,
      take: 6,
      orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
    }),
    db.job.findMany({
      where: {
        ...completed,
        completedAt: { gte: periods.monthStart, lt: now },
      },
      select: jobSelect,
      take: 4,
      orderBy: [{ completedAt: "desc" }, { id: "asc" }],
    }),
  ]);
  // Late work comes first, followed by the nearest schedule and then unscheduled work.
  const scheduled =
    overdueJobs.length < 6
      ? await db.job.findMany({
          where: {
            ...active,
            id: { notIn: overdueJobs.map((job) => job.id) },
            scheduledStart: { not: null },
          },
          select: jobSelect,
          take: 6 - overdueJobs.length,
          orderBy: [{ scheduledStart: "asc" }, { id: "asc" }],
        })
      : [];
  const unscheduledJobs =
    overdueJobs.length + scheduled.length < 6
      ? await db.job.findMany({
          where: {
            ...active,
            scheduledStart: null,
            id: { notIn: overdueJobs.map((job) => job.id) },
          },
          select: jobSelect,
          take: 6 - overdueJobs.length - scheduled.length,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : [];
  const safeJob = (
    job: Prisma.JobGetPayload<{ select: typeof jobSelect }>,
  ) => ({
    ...job,
    assignedStaff:
      job.assignedStaff?.organizationId === organizationId
        ? {
            firstName: job.assignedStaff.firstName,
            lastName: job.assignedStaff.lastName,
          }
        : null,
    isOverdue: overdueJobs.some((late) => late.id === job.id),
  });
  const count = (status: string) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return {
    assigned: count("ASSIGNED"),
    inProgress: count("IN_PROGRESS"),
    overdue: overdueCount,
    scheduledToday: todayCount,
    unscheduled,
    completedThisMonth,
    completedPreviousPeriod,
    completedToday,
    unassigned,
    readyToInvoice,
    weeklyCompletions,
    queue: [...overdueJobs, ...scheduled, ...unscheduledJobs].map(safeJob),
    recentCompletions: recentCompletions.map(safeJob),
  };
}

async function requestsOverview(
  db: Prisma.TransactionClient,
  organizationId: string,
  periods: Periods,
  now: Date,
) {
  const base: Prisma.ServiceRequestWhereInput = {
    organizationId,
    customer: { organizationId },
    serviceType: { organizationId },
  };
  const waiting: Prisma.ServiceRequestWhereInput = {
    ...base,
    status: { in: ["PENDING", "IN_PROGRESS"] },
    jobs: { none: { organizationId, status: { not: "CANCELLED" } } },
  };
  // The existing lifecycle requires at least one job, and every job must be completed.
  const ready: Prisma.ServiceRequestWhereInput = {
    ...base,
    status: "IN_PROGRESS",
    jobs: {
      some: { organizationId },
      every: { organizationId, status: "COMPLETED" },
    },
  };
  const [
    byStatus,
    newThisMonth,
    waitingForAssignment,
    readyToClose,
    dispatchQueue,
    completionQueue,
  ] = await Promise.all([
    db.serviceRequest.groupBy({
      by: ["status"],
      where: base,
      _count: { _all: true },
    }),
    db.serviceRequest.count({
      where: { ...base, createdAt: { gte: periods.monthStart, lt: now } },
    }),
    db.serviceRequest.count({ where: waiting }),
    db.serviceRequest.count({ where: ready }),
    db.serviceRequest.findMany({
      where: waiting,
      select: requestSelect,
      take: 4,
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    }),
    db.serviceRequest.findMany({
      where: ready,
      select: requestSelect,
      take: 4,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const count = (status: string) =>
    byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return {
    pending: count("PENDING"),
    inProgress: count("IN_PROGRESS"),
    completed: count("COMPLETED"),
    cancelled: count("CANCELLED"),
    newThisMonth,
    waitingForAssignment,
    readyToClose,
    dispatchQueue,
    completionQueue,
  };
}

async function billingOverview(
  db: Prisma.TransactionClient,
  organizationId: string,
  periods: Periods,
  now: Date,
) {
  const base: Prisma.InvoiceWhereInput = {
    organizationId,
    status: { not: "VOID" },
    customer: { organizationId },
  };
  const unpaid: Prisma.InvoiceWhereInput = {
    ...base,
    status: { in: ["UNPAID", "PARTIALLY_PAID"] },
  };
  const overdue: Prisma.InvoiceWhereInput = {
    ...unpaid,
    dueAt: { lt: periods.today },
  };
  const [
    billed,
    collected,
    previousCollected,
    outstanding,
    overdueTotals,
    overdueInvoices,
  ] = await Promise.all([
    db.invoice.aggregate({
      where: { ...base, issuedAt: { gte: periods.monthStart, lt: now } },
      _sum: { total: true },
    }),
    db.payment.aggregate({
      where: {
        invoice: base,
        receivedAt: { gte: periods.monthStart, lt: now },
      },
      _sum: { amount: true },
    }),
    db.payment.aggregate({
      where: {
        invoice: base,
        receivedAt: { gte: periods.previousStart, lt: periods.previousEnd },
      },
      _sum: { amount: true },
    }),
    db.invoice.aggregate({
      where: unpaid,
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    }),
    db.invoice.aggregate({
      where: overdue,
      _sum: { total: true, amountPaid: true },
      _count: { _all: true },
    }),
    db.invoice.findMany({
      where: overdue,
      take: 4,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        invoiceNumber: true,
        dueAt: true,
        total: true,
        amountPaid: true,
        customer: { select: { name: true } },
      },
    }),
  ]);
  const decimal = (value: Prisma.Decimal | null) =>
    value ?? new Prisma.Decimal(0);
  return {
    billedThisMonth: decimal(billed._sum.total).toFixed(2),
    collectedThisMonth: decimal(collected._sum.amount).toFixed(2),
    collectedPreviousPeriod: decimal(previousCollected._sum.amount).toFixed(2),
    outstanding: decimal(outstanding._sum.total)
      .sub(decimal(outstanding._sum.amountPaid))
      .toFixed(2),
    unpaidCount: outstanding._count._all,
    overdueCount: overdueTotals._count._all,
    overdueBalance: decimal(overdueTotals._sum.total)
      .sub(decimal(overdueTotals._sum.amountPaid))
      .toFixed(2),
    overdueInvoices: overdueInvoices.map(
      ({ total, amountPaid, ...invoice }) => ({
        ...invoice,
        balance: total.sub(amountPaid).toFixed(2),
      }),
    ),
  };
}

export const dashboardService = {
  async get() {
    const organizationId = tenantOrganization();
    const userId = requestContext.getValue("userId");
    const permissions = requestContext.getValue("permissions") ?? [];
    if (!userId || !permissions.includes(P.DASHBOARD_READ))
      throw new AppError(403, "Forbidden");
    const role = requestContext.getValue("role") ?? "";
    const business =
      isTenantAdminName(role) ||
      role.toLowerCase().replace(/[\s_-]/g, "") === "manager";
    const can = (permission: string) => permissions.includes(permission);
    const now = new Date();
    const periods = dashboardPeriods(now);
    // A read-only snapshot avoids locking business writes while keeping metrics consistent.
    return prisma.$transaction(
      async (db) => {
        const [jobs, requests, billing, customers] = await Promise.all([
          can(P.JOB_READ)
            ? jobsOverview(
                db,
                organizationId,
                business ? undefined : userId,
                now,
                periods,
                business && can(P.INVOICE_READ),
              )
            : null,
          business && can(P.SERVICE_REQUEST_READ)
            ? requestsOverview(db, organizationId, periods, now)
            : null,
          business && can(P.INVOICE_READ)
            ? billingOverview(db, organizationId, periods, now)
            : null,
          business && can(P.CUSTOMER_READ)
            ? db.customer.count({ where: { organizationId, deletedAt: null } })
            : null,
        ]);
        return {
          mode: business ? ("business" as const) : ("staff" as const),
          generatedAt: now.toISOString(),
          timeZone: dashboardTimeZone,
          period: {
            label: periods.label,
            start: periods.monthStart.toISOString(),
            end: now.toISOString(),
            previousStart: periods.previousStart.toISOString(),
            previousEnd: periods.previousEnd.toISOString(),
          },
          jobs,
          requests,
          billing,
          customers,
        };
      },
      { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 15000 },
    );
  },
};
