import { prisma } from "@/lib/prisma";
import type { AccessLogQuery } from "./access-logs.schema";

export async function listAccessLogs({ page, limit, ip }: AccessLogQuery) {
  const where = ip ? { ip } : {};
  const [items, total] = await prisma.$transaction([
    prisma.accessLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * limit, take: limit }),
    prisma.accessLog.count({ where }),
  ]);
  return { items, pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function topAccessIps() {
  const where = { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } };
  const groups = await prisma.accessLog.groupBy({
    by: ["ip"], where, _count: { _all: true }, _max: { createdAt: true },
    orderBy: [{ _count: { ip: "desc" } }, { ip: "asc" }], take: 20,
  });
  if (!groups.length) return [];
  // One bounded batch for the latest country, including deterministic same-time ties.
  const latest = await prisma.accessLog.findMany({
    where: { OR: groups.map((group) => ({ ip: group.ip, createdAt: group._max.createdAt! })) },
    orderBy: { id: "desc" }, distinct: ["ip"], select: { ip: true, country: true },
  });
  const countries = new Map(latest.map((row) => [row.ip, row.country]));
  return groups.map((group) => ({
    ip: group.ip, country: countries.get(group.ip) ?? null, hitCount: group._count._all, lastSeen: group._max.createdAt,
  }));
}

export async function pruneAccessLogs() {
  return prisma.accessLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } });
}
