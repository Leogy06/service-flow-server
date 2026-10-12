import { validateTransition } from "../../src/modules/service-request/lifecycle.js";
import { createRequestInput, requestListInput, createTypeInput } from "../../src/modules/service-request/service-request.schema.js";
import type { ServiceRequestStatus, JobStatus } from "../../src/generated/prisma/client.js";

describe("Service request lifecycle", () => {
  const statuses: ServiceRequestStatus[] = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
  const allowed = new Set(["PENDING:IN_PROGRESS", "PENDING:CANCELLED", "IN_PROGRESS:COMPLETED", "IN_PROGRESS:CANCELLED"]);
  it.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))("validates %s to %s", (from, to) => {
    const run = () => validateTransition(from, to, [{ status: "COMPLETED" }]);
    if (allowed.has(`${from}:${to}`)) expect(run).not.toThrow(); else expect(run).toThrow("Invalid request status transition");
  });
  it("requires jobs and every job completed", () => {
    expect(() => validateTransition("IN_PROGRESS", "COMPLETED", [])).toThrow("at least one job");
    for (const status of ["ASSIGNED", "IN_PROGRESS", "CANCELLED"] as JobStatus[]) {
      expect(() => validateTransition("IN_PROGRESS", "COMPLETED", [{ status: "COMPLETED" }, { status }])).toThrow("Complete every related job");
    }
    expect(() => validateTransition("IN_PROGRESS", "COMPLETED", [{ status: "COMPLETED" }, { status: "COMPLETED" }])).not.toThrow();
  });
  it("prevents cancellation while related work is active", () => {
    expect(() => validateTransition("PENDING", "CANCELLED", [{ status: "ASSIGNED" }])).toThrow("active jobs");
    expect(() => validateTransition("IN_PROGRESS", "CANCELLED", [{ status: "IN_PROGRESS" }])).toThrow("active jobs");
    expect(() => validateTransition("PENDING", "CANCELLED", [{ status: "CANCELLED" }, { status: "COMPLETED" }])).not.toThrow();
  });
});
describe("Request input validation", () => {
  it("strips fields outside the request contract", () => {
    expect(createRequestInput.parse({ body: { customerId: "c", serviceTypeId: "s", title: " Test ", organizationId: "other", status: "COMPLETED", trackingToken: "private", referenceNumber: "client" } }).body)
      .toEqual({ customerId: "c", serviceTypeId: "s", title: "Test", description: "", priority: "NORMAL" });
  });
  it.each([{ page: 0 }, { pageSize: 101 }, { sortBy: "title" }, { sortOrder: "invalid" }, { status: "invalid" }, { serviceTypeId: "" }])("rejects invalid list input %j", (query) => {
    expect(requestListInput.safeParse({ query }).success).toBe(false);
  });
  it.each([-1, 100_000_000, 0.001, "invalid"])("rejects invalid base price %s", (basePrice) => {
    expect(createTypeInput.safeParse({ body: { name: "Repair", basePrice } }).success).toBe(false);
  });
});
