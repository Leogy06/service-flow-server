import { reportWindow, revenueTotals, revenueSeries, csvCell } from "@/modules/system-admin/operations-policy.js";
import { settingsSchema } from "@/modules/system-admin/operations.schema.js";

test("report window uses complete Manila days and caps expensive range scans", () => {
  const window = reportWindow("2026-01-01", "2026-01-31");
  expect(window.start.toISOString()).toBe("2025-12-31T16:00:00.000Z");
  expect(window.end.toISOString()).toBe("2026-01-31T16:00:00.000Z");
  expect(() => reportWindow("2026-01-02", "2026-01-01")).toThrow();
  expect(() => reportWindow("2025-01-01", "2026-01-02")).toThrow();
  expect(() => reportWindow("2026-02-30", "2026-03-01")).toThrow();
});

test("verified gross includes refunded receipts and subtracts refund events separately", () => {
  expect(revenueTotals([{ currency: "PHP", amount: "2999.00" }, { currency: "PHP", amount: "5999.00" }], [{ currency: "PHP", amount: "2999.00" }])).toEqual([
    { currency: "PHP", gross: "8998.00", refunds: "2999.00", net: "5999.00" },
  ]);
});
test("currency totals stay separate and exact to cents", () => {
  expect(revenueTotals([{ currency: "USD", amount: "0.10" }, { currency: "USD", amount: "0.20" }], [{ currency: "PHP", amount: "9999.00" }])).toEqual([
    { currency: "PHP", gross: "0.00", refunds: "9999.00", net: "-9999.00" },
    { currency: "USD", gross: "0.30", refunds: "0.00", net: "0.30" },
  ]);
});
test("refund trends use refund date even when receipt fell in another period", () => {
  expect(revenueSeries([{ date: "2026-01-01", currency: "PHP", amount: "100.00" }], [{ date: "2026-02-01", currency: "PHP", amount: "100.00" }])).toEqual([
    { date: "2026-01-01", currency: "PHP", gross: "100.00", refunds: "0.00", net: "100.00" },
    { date: "2026-02-01", currency: "PHP", gross: "0.00", refunds: "100.00", net: "-100.00" },
  ]);
});
test.each(["=HYPERLINK(\"bad\")", "+cmd", "  @SUM(1)", "-danger"])("CSV neutralizes formula injection: %s", (value) => {
  expect(csvCell(value).startsWith('"\'')).toBe(true);
});
test("CSV quotes text, separators and embedded quotes", () => {
  expect(csvCell('A, "B"')).toBe('"A, ""B"""');
  expect(csvCell(null)).toBe('""');
});
test("settings reject duplicates, overlong grace, secrets and missing confirmation", () => {
  const body = { confirm: true, reason: "Operator adjustment", reminderIntervals: [30, 7], gracePeriodDays: 0, paymentInstructions: "Bank transfer instructions", supportEmail: null, supportPhone: null, maintenanceMessage: "", defaultPlanId: null };
  expect(settingsSchema.safeParse({ body }).success).toBe(true);
  expect(settingsSchema.safeParse({ body: { ...body, reminderIntervals: [7, 7] } }).success).toBe(false);
  expect(settingsSchema.safeParse({ body: { ...body, gracePeriodDays: 31 } }).success).toBe(false);
  expect(settingsSchema.safeParse({ body: { ...body, apiKey: "secret" } }).success).toBe(false);
  expect(settingsSchema.safeParse({ body: { ...body, confirm: false } }).success).toBe(false);
});
