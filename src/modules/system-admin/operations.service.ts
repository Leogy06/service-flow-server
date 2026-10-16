import { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "@/lib/prisma.js";
import { redis } from "@/lib/redis.js";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
import { AppError } from "@/utils/AppError.js";
import { pagination } from "@/utils/tenant-transaction.js";
import {
  lockOrganization,
  platformTransaction,
  recordPlatformAudit,
} from "./platform-audit.js";
import {
  csvCell,
  defaultSettings,
  reportWindow,
  revenueSeries,
  revenueTotals,
  type RevenueRow,
} from "./operations-policy.js";
import { trafficSnapshot } from "./telemetry.js";
import type { AlertListQuery, SettingsInput } from "./operations.schema.js";

async function readSettings(db: Prisma.TransactionClient = prisma) {
  const settings = await db.platformSettings.findUnique({
    where: { id: "singleton" },
  });
  return settings ?? defaultSettings;
}

export const operationsService = {
  async dashboard(query: { from?: string; to?: string }) {
    await requirePlatformAuthority();
    const window = reportWindow(query.from, query.to);
    const now = new Date();
    const soon = new Date(+now + 30 * 86400000);
    return prisma.$transaction(
      async (db) => {
        const [
          totalOrganizations,
          activeOrganizations,
          suspendedOrganizations,
          activeSubscriptions,
          activeTrials,
          expiringSubscriptions,
          expiredSubscriptions,
          pendingPaymentVerifications,
          newTenantRegistrations,
          totalActiveUsers,
          failedLoginAttempts,
          registrations,
          gross,
          refunds,
          subscriptionDistribution,
          recentActivities,
          recentPayments,
          alerts,
        ] = await Promise.all([
          db.organization.count(),
          db.organization.count({ where: { status: "ACTIVE" } }),
          db.organization.count({ where: { status: "SUSPENDED" } }),
          db.subscription.count({
            where: {
              status: "ACTIVE",
              startsAt: { lte: now },
              expiresAt: { gt: now },
            },
          }),
          db.subscription.count({
            where: {
              status: "TRIALING",
              startsAt: { lte: now },
              expiresAt: { gt: now },
            },
          }),
          db.subscription.count({
            where: {
              status: { in: ["ACTIVE", "TRIALING"] },
              expiresAt: { gt: now, lte: soon },
            },
          }),
          db.subscription.count({
            where: {
              OR: [
                { status: "EXPIRED" },
                {
                  status: { in: ["ACTIVE", "TRIALING"] },
                  expiresAt: { lte: now },
                },
              ],
            },
          }),
          db.subscriptionPayment.count({
            where: { status: { in: ["PENDING", "UNDER_REVIEW"] } },
          }),
          db.organization.count({
            where: { createdAt: { gte: window.start, lt: window.end } },
          }),
          db.user.count({
            where: {
              organizationId: { not: null },
              status: "ACTIVE",
              deletedAt: null,
              securityStatus: "ACTIVE",
            },
          }),
          db.auditLog.count({
            where: {
              scope: "PLATFORM",
              action: "auth.login.failure",
              createdAt: { gte: window.start, lt: window.end },
            },
          }),
          db.$queryRaw<
            Array<{ date: string; count: bigint }>
          >`SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 8 HOUR), '%Y-%m-%d') AS date, COUNT(*) AS count FROM Organization WHERE createdAt >= ${window.start} AND createdAt < ${window.end} GROUP BY DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 8 HOUR), '%Y-%m-%d') ORDER BY date`,
          db.$queryRaw<
            RevenueRow[]
          >`SELECT DATE_FORMAT(DATE_ADD(verifiedAt, INTERVAL 8 HOUR), '%Y-%m-%d') AS date, currency, SUM(amount) AS amount FROM SubscriptionPayment WHERE verifiedAt >= ${window.start} AND verifiedAt < ${window.end} AND status IN ('PAID', 'REFUNDED') GROUP BY DATE_FORMAT(DATE_ADD(verifiedAt, INTERVAL 8 HOUR), '%Y-%m-%d'), currency ORDER BY date`,
          db.$queryRaw<
            RevenueRow[]
          >`SELECT DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 8 HOUR), '%Y-%m-%d') AS date, currency, SUM(amount) AS amount FROM SubscriptionRefund WHERE createdAt >= ${window.start} AND createdAt < ${window.end} GROUP BY DATE_FORMAT(DATE_ADD(createdAt, INTERVAL 8 HOUR), '%Y-%m-%d'), currency ORDER BY date`,
          db.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
          db.auditLog.findMany({
            where: {
              scope: "PLATFORM",
              createdAt: { gte: window.start, lt: window.end },
            },
            take: 10,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: {
              actor: { select: { id: true, firstName: true, lastName: true } },
            },
          }),
          db.subscriptionPayment.findMany({
            where: { createdAt: { gte: window.start, lt: window.end } },
            take: 10,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: {
              organization: { select: { id: true, name: true, slug: true } },
            },
          }),
          db.platformAlert.findMany({
            where: { resolvedAt: null },
            take: 10,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
        ]);
        return {
          window: { from: window.from, to: window.to },
          metrics: {
            totalOrganizations,
            activeOrganizations,
            suspendedOrganizations,
            activeSubscriptions,
            activeTrials,
            expiringSubscriptions,
            expiredSubscriptions,
            pendingPaymentVerifications,
            newTenantRegistrations,
            totalActiveUsers,
            failedLoginAttempts,
          },
          revenue: revenueTotals(gross, refunds),
          registrationTrend: registrations.map((r) => ({
            date: r.date,
            count: Number(r.count),
          })),
          revenueTrend: revenueSeries(gross, refunds),
          subscriptionDistribution: subscriptionDistribution.map((r) => ({
            status: r.status,
            count: r._count._all,
          })),
          recentActivities,
          recentPayments,
          alerts,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 15000 },
    );
  },

  async settings() {
    await requirePlatformAuthority();
    return readSettings();
  },
  async updateSettings(input: SettingsInput) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const before = await readSettings(db);
      if (
        input.defaultPlanId &&
        !(await db.plan.findFirst({
          where: { id: input.defaultPlanId, isActive: true },
          select: { id: true },
        }))
      ) {
        throw new AppError(400, "Default plan must be available");
      }
      const { confirm: _confirm, reason, ...data } = input;
      const after = await db.platformSettings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", ...data },
        update: data,
      });
      await recordPlatformAudit(db, {
        action: "platform.settings.update",
        entity: "PlatformSettings",
        entityId: "singleton",
        before: JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue,
        after: { ...data, reason },
      });
      return after;
    });
  },

  async alerts(query: AlertListQuery) {
    await requirePlatformAuthority();
    return prisma.$transaction(
      async (db) => {
        const where = {
          resolvedAt: null,
          ...(query.unread === "true" ? { readAt: null } : {}),
        };
        const total = await db.platformAlert.count({ where });
        const paging = pagination(query.page, query.pageSize, total);
        return {
          items: await db.platformAlert.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: query.pageSize,
            skip: (paging.page - 1) * query.pageSize,
          }),
          pagination: paging,
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  },
  async readAlert(id: string, reason: string) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const alert = await db.platformAlert.findUnique({ where: { id } });
      if (!alert) throw new AppError(404, "Alert not found");
      const after = await db.platformAlert.update({
        where: { id },
        data: { readAt: alert.readAt ?? new Date() },
      });
      await recordPlatformAudit(db, {
        action: "platform.alert.read",
        entity: "PlatformAlert",
        entityId: id,
        organizationId: alert.organizationId,
        after: { reason },
      });
      return after;
    });
  },

  async billingReport(query: { from?: string; to?: string }) {
    await requirePlatformAuthority();
    const window = reportWindow(query.from, query.to);
    return prisma.$transaction(
      async (db) => {
        const [payments, refunds] = await Promise.all([
          db.subscriptionPayment.findMany({
            where: {
              status: { in: ["PAID", "REFUNDED"] },
              verifiedAt: { gte: window.start, lt: window.end },
            },
            take: 10001,
            orderBy: [{ verifiedAt: "asc" }, { id: "asc" }],
            include: { organization: { select: { name: true } } },
          }),
          db.subscriptionRefund.findMany({
            where: { createdAt: { gte: window.start, lt: window.end } },
            take: 10001,
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: {
              payment: {
                select: {
                  referenceNumber: true,
                  organization: { select: { name: true } },
                },
              },
            },
          }),
        ]);
        if (payments.length + refunds.length > 10000)
          throw new AppError(
            400,
            "Report exceeds 10,000 events. Select a narrower date range",
          );
        const rows: unknown[][] = [
          [
            "Event",
            "ID",
            "Organization",
            "Reference",
            "Currency",
            "Gross",
            "Refund",
            "Event date",
          ],
        ];
        payments.forEach((p) =>
          rows.push([
            "PAYMENT",
            p.id,
            p.organization.name,
            p.referenceNumber,
            p.currency,
            p.amount.toFixed(2),
            "0.00",
            p.verifiedAt!.toISOString(),
          ]),
        );
        refunds.forEach((r) =>
          rows.push([
            "REFUND",
            r.id,
            r.payment.organization.name,
            r.payment.referenceNumber,
            r.currency,
            "0.00",
            r.amount.toFixed(2),
            r.createdAt.toISOString(),
          ]),
        );
        return {
          filename: `serviceflow-billing-${window.from}-${window.to}.csv`,
          csv: rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 15000 },
    );
  },

  async monitoring() {
    await requirePlatformAuthority();
    const services = await healthServices();
    return {
      status:
        services.database.status === "up" && services.redis.status === "up"
          ? "healthy"
          : "degraded",
      checkedAt: new Date().toISOString(),
      services,
      traffic: trafficSnapshot(),
      backgroundJobs: null,
      databaseStorageBytes: null,
    };
  },
};

let cachedHealth:
  | {
      at: number;
      services: {
        api: { status: string };
        database: { status: string };
        redis: { status: string };
      };
    }
  | undefined;
let healthFlight: Promise<NonNullable<typeof cachedHealth>["services"]> | null =
  null;
async function healthServices() {
  if (cachedHealth && Date.now() - cachedHealth.at < 15000)
    return cachedHealth.services;
  if (!healthFlight)
    healthFlight = (async () => {
      const check = async (promise: Promise<unknown>) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            promise,
            new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error("timeout")), 2000);
            }),
          ]);
          return { status: "up" };
        } catch {
          return { status: "down" };
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      };
      const [database, redisState] = await Promise.all([
        check(prisma.$queryRaw`SELECT 1`),
        check(redis.ping()),
      ]);
      const services = { api: { status: "up" }, database, redis: redisState };
      cachedHealth = { at: Date.now(), services };
      return services;
    })().finally(() => {
      healthFlight = null;
    });
  return healthFlight;
}

type AlertInput = {
  key: string;
  organizationId?: string | null;
  kind: string;
  severity: string;
  message: string;
  targetType: string;
  targetId: string;
};
// The live API observer records actual 5xx incidents, at most once per minute.
// Alerts deduplicate per instance/hour; no raw exception or credential is stored.
export function recordPlatformServerError(instanceId: string) {
  return platformTransaction((db) =>
    emitAlert(db, {
      key: `errors:${instanceId}:${new Date().toISOString().slice(0, 13)}`,
      kind: "PLATFORM_ERROR",
      severity: "critical",
      message:
        "API server errors observed. Inspect server logs using the monitoring request IDs.",
      targetType: "Platform",
      targetId: instanceId,
    }),
  );
}
async function emitAlert(db: Prisma.TransactionClient, a: AlertInput) {
  const { key, ...data } = a;
  return db.platformAlert.upsert({
    where: { deduplicationKey: key },
    create: { deduplicationKey: key, ...data },
    update: { resolvedAt: null },
  });
}

// Operator CLI and authorized route share this bounded, restartable scheduler operation.
export async function processPlatformAlerts(cursor?: string, now = new Date()) {
  const [phase = "s", after = ""] = (cursor ?? "s|").split("|");
  if (
    !["s", "p", "o", "e"].includes(phase) ||
    (cursor && !/^[spoe]\|[a-zA-Z0-9_-]*$/.test(cursor))
  )
    throw new AppError(400, "Invalid alert cursor");
  const batch = 200;
  let processed = 0;
  let nextCursor: string | null = null;
  if (phase === "s") {
    const settings = await readSettings();
    const intervals: number[] = Array.isArray(settings.reminderIntervals)
      ? Array.from(settings.reminderIntervals).flatMap((v) =>
          typeof v === "number" ? [v] : [],
        )
      : [30, 7];
    const rows = await prisma.subscription.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: "asc" },
      take: batch,
    });
    for (const row of rows)
      await platformTransaction(async (db) => {
        await lockOrganization(db, row.organizationId);
        const s = await db.subscription.findUnique({ where: { id: row.id } });
        if (!s) return;
        const keys: string[] = [];
        if (
          s.expiresAt &&
          ["TRIALING", "ACTIVE", "PAST_DUE", "EXPIRED"].includes(s.status)
        ) {
          const trial = Boolean(s.trialStartedAt && !s.currentPeriodPaymentId);
          const grace =
            s.status === "PAST_DUE" ? settings.gracePeriodDays * 86400000 : 0;
          const expired = +s.expiresAt + grace <= +now;
          if (expired && s.status !== "EXPIRED") {
            await db.subscription.update({
              where: { id: s.id },
              data: { status: "EXPIRED", version: { increment: 1 } },
            });
            await db.subscriptionHistory.create({
              data: {
                subscriptionId: s.id,
                kind: "EXPIRED",
                reason: trial
                  ? "Free trial expired"
                  : "Subscription entitlement expired",
                before: { status: s.status },
                after: { status: "EXPIRED" },
              },
            });
            await recordPlatformAudit(db, {
              action: "platform.subscription.expire",
              entity: "Subscription",
              entityId: s.id,
              organizationId: s.organizationId,
              before: { status: s.status },
              after: { status: "EXPIRED" },
            });
          }
          for (const days of expired
            ? [0]
            : intervals.filter((n) => +s.expiresAt! - +now <= n * 86400000)) {
            const key = `subscription:${s.id}:${s.expiresAt.toISOString()}:${days}`;
            keys.push(key);
            await emitAlert(db, {
              key,
              organizationId: s.organizationId,
              kind: trial
                ? expired
                  ? "TRIAL_EXPIRED"
                  : "TRIAL_EXPIRING"
                : expired
                  ? "SUBSCRIPTION_EXPIRED"
                  : "SUBSCRIPTION_EXPIRING",
              severity: expired || days <= 7 ? "critical" : "warning",
              message: expired
                ? trial
                  ? "Free trial has expired; verify payment to restore access."
                  : "Subscription has expired."
                : `${trial ? "Free trial" : "Subscription"} expires within ${days} days.`,
              targetType: "Subscription",
              targetId: s.id,
            });
          }
        }
        await db.platformAlert.updateMany({
          where: {
            targetType: "Subscription",
            targetId: s.id,
            resolvedAt: null,
            ...(keys.length ? { deduplicationKey: { notIn: keys } } : {}),
          },
          data: { resolvedAt: now },
        });
      });
    processed = rows.length;
    nextCursor = rows.length === batch ? `s|${rows.at(-1)!.id}` : "p|";
  } else if (phase === "p") {
    const rows = await prisma.subscriptionPayment.findMany({
      where: after ? { id: { gt: after } } : {},
      take: batch,
      orderBy: { id: "asc" },
    });
    for (const initial of rows)
      await platformTransaction(async (db) => {
        await lockOrganization(db, initial.organizationId);
        const p = await db.subscriptionPayment.findUnique({
          where: { id: initial.id },
        });
        if (!p) return;
        if (["PENDING", "UNDER_REVIEW", "REJECTED"].includes(p.status)) {
          await emitAlert(db, {
            key: `payment:${p.id}:${p.status}`,
            organizationId: p.organizationId,
            kind: p.status === "REJECTED" ? "RENEWAL_FAILED" : "PAYMENT_REVIEW",
            severity: "warning",
            message:
              p.status === "REJECTED"
                ? "Subscription payment was rejected; review renewal access."
                : "Subscription payment awaits verification.",
            targetType: "SubscriptionPayment",
            targetId: p.id,
          });
        }
        await db.platformAlert.updateMany({
          where: {
            targetType: "SubscriptionPayment",
            targetId: p.id,
            deduplicationKey: { not: `payment:${p.id}:${p.status}` },
            resolvedAt: null,
          },
          data: { resolvedAt: now },
        });
      });
    processed = rows.length;
    nextCursor = rows.length === batch ? `p|${rows.at(-1)!.id}` : "o|";
  } else if (phase === "o") {
    const rows = await prisma.organization.findMany({
      where: after ? { id: { gt: after } } : {},
      take: batch,
      orderBy: { id: "asc" },
      select: { id: true, status: true, statusChangedAt: true },
    });
    for (const initial of rows)
      await platformTransaction(async (db) => {
        await lockOrganization(db, initial.id);
        const o = await db.organization.findUnique({
          where: { id: initial.id },
          select: { id: true, status: true, statusChangedAt: true },
        });
        if (!o) return;
        if (["SUSPENDED", "ARCHIVED"].includes(o.status))
          await emitAlert(db, {
            key: `organization:${o.id}:${o.statusChangedAt?.toISOString() ?? o.status}`,
            organizationId: o.id,
            kind: "TENANT_SUSPENDED",
            severity: "warning",
            message: `Organization access is ${o.status.toLowerCase()}.`,
            targetType: "Organization",
            targetId: o.id,
          });
        else
          await db.platformAlert.updateMany({
            where: {
              targetType: "Organization",
              targetId: o.id,
              resolvedAt: null,
            },
            data: { resolvedAt: now },
          });
      });
    processed = rows.length;
    nextCursor = rows.length === batch ? `o|${rows.at(-1)!.id}` : "e|";
  } else {
    const traffic = trafficSnapshot();
    if (traffic.errorCount)
      await platformTransaction((db) =>
        emitAlert(db, {
          key: `errors:${traffic.instanceId}:${now.toISOString().slice(0, 13)}`,
          kind: "PLATFORM_ERROR",
          severity: "critical",
          message:
            "API server errors observed in the last hour. Inspect server logs using the monitoring request IDs.",
          targetType: "Platform",
          targetId: traffic.instanceId,
        }),
      );
  }
  return { processed, nextCursor, hasMore: nextCursor !== null };
}
