import { Prisma } from "@/generated/prisma/client.js";
import { AppError } from "@/utils/AppError.js";

export function reportWindow(from?: string, to?: string, now = new Date()) {
  const manilaDate = (value: Date) => new Date(+value + 8 * 3600000).toISOString().slice(0, 10);
  const endDay = to ?? manilaDate(now);
  const startDay = from ?? manilaDate(new Date(now.getTime() - 29 * 86400000));
  const start = new Date(`${startDay}T00:00:00.000+08:00`);
  const last = new Date(`${endDay}T00:00:00.000+08:00`);
  if (!Number.isFinite(+start) || !Number.isFinite(+last) || manilaDate(start) !== startDay ||
    manilaDate(last) !== endDay || +last < +start || +last - +start > 365 * 86400000) {
    throw new AppError(400, "Choose a valid date range of at most 366 days");
  }
  return { start, end: new Date(+last + 86400000), from: startDay, to: endDay };
}

export type RevenueRow = { currency: string; amount: Prisma.Decimal | string | number; date?: string };
export function revenueTotals(gross: RevenueRow[], refunds: RevenueRow[]) {
  const totals = new Map<string, { currency: string; gross: Prisma.Decimal; refunds: Prisma.Decimal }>();
  const add = (row: RevenueRow, kind: "gross" | "refunds") => {
    const total = totals.get(row.currency) ?? { currency: row.currency, gross: new Prisma.Decimal(0), refunds: new Prisma.Decimal(0) };
    total[kind] = total[kind].plus(row.amount); totals.set(row.currency, total);
  };
  gross.forEach((r) => add(r, "gross")); refunds.forEach((r) => add(r, "refunds"));
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)).map((r) => ({
    currency: r.currency, gross: r.gross.toFixed(2), refunds: r.refunds.toFixed(2), net: r.gross.minus(r.refunds).toFixed(2),
  }));
}

export function revenueSeries(gross: RevenueRow[], refunds: RevenueRow[]) {
  const dates = [...new Set([...gross, ...refunds].map((r) => r.date!))].sort();
  return dates.flatMap((date) => revenueTotals(gross.filter((r) => r.date === date), refunds.filter((r) => r.date === date)).map((r) => ({ date, ...r })));
}

export function csvCell(value: unknown) {
  const raw = value == null ? "" : String(value);
  const safe = /^\s*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export const defaultSettings = {
  reminderIntervals: [30, 7], gracePeriodDays: 0, paymentInstructions: "",
  supportEmail: null, supportPhone: null, maintenanceMessage: "", defaultPlanId: null,
};
