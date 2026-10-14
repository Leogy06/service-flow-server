import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { calculateItems } from "../../src/modules/invoice/money.js";
import { checkJobTransition } from "../../src/modules/job/lifecycle.js";
import { createInvoiceInput, updateInvoiceInput } from "../../src/modules/invoice/invoice.schema.js";
import { recordPaymentInput } from "../../src/modules/payment/payment.schema.js";
import { createJobInput, updateJobInput } from "../../src/modules/job/job.schema.js";
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
describe("Job schedule validation", () => {
  const now = Date.parse("2026-10-14T02:00:30Z");
  const futureStart = "2026-10-14T11:00:00+08:00";
  const futureEnd = "2026-10-14T12:00:00+08:00";
  const create = (schedule: Record<string, unknown>) => createJobInput.safeParse({ body: {
    serviceRequestId: "request", assignedStaffId: "staff", ...schedule,
  } });
  const update = (schedule: Record<string, unknown>) => updateJobInput.safeParse({ params: { id: "job" }, body: schedule });
  beforeEach(() => { jest.spyOn(Date, "now").mockReturnValue(now); });
  afterEach(() => { jest.restoreAllMocks(); });

  describe.each([["create", create], ["update", update]] as const)("%s", (_name, parse) => {
    it.each(["scheduledStart", "scheduledEnd"])("rejects past, current and invalid %s with a field error", (field) => {
      for (const value of ["2026-10-13T12:00:00Z", "2026-10-14T09:59:00+08:00", "2026-10-14T10:00:30+08:00", "invalid"]) {
        const result = parse({ scheduledStart: futureStart, scheduledEnd: futureEnd, [field]: value });
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error.issues.some((issue) => issue.path.join(".") === `body.${field}`)).toBe(true);
      }
    });
    it("accepts future dates and normalizes timezone offsets", () => {
      const result = parse({ scheduledStart: futureStart, scheduledEnd: futureEnd });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body.scheduledStart?.toISOString()).toBe("2026-10-14T03:00:00.000Z");
        expect(result.data.body.scheduledEnd?.toISOString()).toBe("2026-10-14T04:00:00.000Z");
      }
    });
    it("allows clearing a schedule", () => {
      expect(parse({ scheduledStart: null, scheduledEnd: null }).success).toBe(true);
    });
    it("uses the time of validation even after the schemas were loaded", () => {
      expect(parse({ scheduledStart: futureStart }).success).toBe(true);
      jest.spyOn(Date, "now").mockReturnValue(Date.parse(futureStart) + 1);
      expect(parse({ scheduledStart: futureStart }).success).toBe(false);
    });
  });
  it("allows unscheduled creation and updates unrelated to the schedule", () => {
    expect(create({}).success).toBe(true);
    const result = update({ internalNotes: "Updated notes" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.scheduledStart).toBeUndefined();
      expect(result.data.body.scheduledEnd).toBeUndefined();
    }
  });
  it("requires a start when creating an end and rejects an end before a future start", () => {
    expect(create({ scheduledEnd: futureEnd }).success).toBe(false);
    const result = create({ scheduledStart: futureEnd, scheduledEnd: futureStart });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["body", "scheduledEnd"]);
  });
});

describe("Invoice due date validation", () => {
  const now = Date.parse("2026-10-14T02:00:30Z");
  const items = [{ description: "Work", quantity: "1", unitPrice: "10.25" }];
  const create = (dueDate: Record<string, unknown>) => createInvoiceInput.safeParse({ body: { jobId: "job", items, ...dueDate } });
  const update = (dueDate: Record<string, unknown>) => updateInvoiceInput.safeParse({ params: { id: "invoice" }, body: { items, ...dueDate } });
  beforeEach(() => { jest.spyOn(Date, "now").mockReturnValue(now); });
  afterEach(() => { jest.restoreAllMocks(); });

  describe.each([["create", create], ["update", update]] as const)("%s", (_name, parse) => {
    it.each(["2026-10-13T23:59:59+08:00", "2026-10-14T02:00:29Z", "2026-10-14T02:00:30Z", "invalid"])("rejects an elapsed or invalid due date %s", (dueAt) => {
      const result = parse({ dueAt });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some((issue) => issue.path.join(".") === "body.dueAt")).toBe(true);
    });
    it.each(["2026-10-14T23:59:59+08:00", "2026-10-15T23:59:59+08:00"])("accepts today or a future due date %s", (dueAt) => {
      const result = parse({ dueAt });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.body.dueAt?.toISOString()).toBe(new Date(dueAt).toISOString());
    });
    it("allows no due date, clearing it and updates that omit it", () => {
      expect(parse({}).success).toBe(true);
      expect(parse({ dueAt: null }).success).toBe(true);
    });
    it("checks the current time on each validation", () => {
      const dueAt = "2026-10-14T23:59:59+08:00";
      expect(parse({ dueAt }).success).toBe(true);
      jest.spyOn(Date, "now").mockReturnValue(Date.parse(dueAt) + 1);
      expect(parse({ dueAt }).success).toBe(false);
    });
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
});
