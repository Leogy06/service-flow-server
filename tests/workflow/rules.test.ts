import { calculateItems } from "../../src/modules/invoice/money.js";
import { checkJobTransition } from "../../src/modules/job/lifecycle.js";
import { createInvoiceInput } from "../../src/modules/invoice/invoice.schema.js";
import { recordPaymentInput } from "../../src/modules/payment/payment.schema.js";
import { createJobInput } from "../../src/modules/job/job.schema.js";
import type { JobStatus } from "../../src/generated/prisma/client.js";

describe("Exact invoice calculations", () => {
  it("rounds each fractional line half up before summing", () => {
    const result = calculateItems([
      { description: "Half cent", quantity: "0.50", unitPrice: "0.01" },
      { description: "Half cent", quantity: "0.50", unitPrice: "0.01" },
      { description: "Decimal multiplication", quantity: "3", unitPrice: "0.10" },
    ]);
    expect(result.lines.map((line) => line.amount.toFixed(2))).toEqual(["0.01", "0.01", "0.30"]);
    expect(result.total.toFixed(2)).toBe("0.32");
  });
  it.each([
    [{ description: "Zero", quantity: "1", unitPrice: "0" }],
    [{ description: "Overflow", quantity: "2", unitPrice: "99999999.99" }],
    [{ description: "Overflow sum", quantity: "1", unitPrice: "99999999.99" }, { description: "Another", quantity: "1", unitPrice: "0.01" }],
  ])("rejects zero or overflowing totals", (...items) => {
    expect(() => calculateItems(items as { description: string; quantity: string; unitPrice: string }[])).toThrow();
  });
  it("accepts the maximum exact persisted total", () => {
    expect(calculateItems([{ description: "Maximum", quantity: "1", unitPrice: "99999999.99" }]).total.toFixed(2)).toBe("99999999.99");
  });
});
describe("Job transitions", () => {
  const states: JobStatus[] = ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  const allowed = new Set(["ASSIGNED:IN_PROGRESS", "ASSIGNED:CANCELLED", "IN_PROGRESS:COMPLETED", "IN_PROGRESS:CANCELLED"]);
  it.each(states.flatMap((from) => states.map((to) => [from, to] as const)))("validates %s to %s", (from, to) => {
    const action = () => checkJobTransition(from, to);
    if (allowed.has(`${from}:${to}`)) expect(action).not.toThrow(); else expect(action).toThrow("Invalid job status transition");
  });
});
describe("Workflow validation", () => {
  it("never accepts authoritative totals or ownership from invoice clients", () => {
    const body = createInvoiceInput.parse({ body: { jobId: "job", items: [{ description: "Work", quantity: "1", unitPrice: "10.25", amount: "999" }], total: "999", organizationId: "foreign", customerId: "foreign" } }).body;
    expect(body).toEqual({ jobId: "job", notes: "", items: [{ description: "Work", quantity: "1", unitPrice: "10.25" }] });
  });
  it.each(["0", "-1", "1.001", "100000000", "NaN", "1e2"])("rejects invalid payment amounts %s", (amount) => {
    expect(recordPaymentInput.safeParse({ params: { id: "invoice" }, body: { idempotencyKey: "0bf35b57-6adf-4668-b32d-3d9f7d62d6df", amount, method: "CASH" } }).success).toBe(false);
  });
  it("requires a retry key and supported payment method", () => {
    expect(recordPaymentInput.safeParse({ params: { id: "invoice" }, body: { amount: "10", method: "CRYPTO" } }).success).toBe(false);
  });
  it("rejects inconsistent job schedules", () => {
    expect(createJobInput.safeParse({ body: { serviceRequestId: "r", assignedStaffId: "s", scheduledStart: "2026-10-13T10:00:00+08:00", scheduledEnd: "2026-10-13T09:00:00+08:00" } }).success).toBe(false);
  });
});
