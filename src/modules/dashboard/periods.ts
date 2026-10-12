// The application bills in PHP and has no organization timezone setting yet.
export const dashboardTimeZone = "Asia/Manila";
const offset = 8 * 60 * 60 * 1000;

export function dashboardPeriods(now: Date) {
  const local = new Date(now.getTime() + offset);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const midnight = (day: number, monthOffset = 0) =>
    new Date(Date.UTC(year, month + monthOffset, day) - offset);
  const monthStart = midnight(1);
  const nextMonth = midnight(1, 1);
  const previousStart = midnight(1, -1);
  // Compare equal elapsed periods, capped for shorter previous months.
  const previousEnd = new Date(Math.min(
    previousStart.getTime() + now.getTime() - monthStart.getTime(), monthStart.getTime(),
  ));
  const weeks = [1, 8, 15, 22, 29].filter((day) => midnight(day) < nextMonth).map((day) => ({
    label: `${day}-${Math.min(day + 6, new Date(nextMonth.getTime() + offset - 1).getUTCDate())}`,
    start: midnight(day),
    end: new Date(Math.min(midnight(day + 7).getTime(), nextMonth.getTime(), now.getTime())),
  }));
  return {
    monthStart, previousStart, previousEnd, weeks,
    today: midnight(local.getUTCDate()), tomorrow: midnight(local.getUTCDate() + 1),
    label: new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: dashboardTimeZone }).format(now),
  };
}
