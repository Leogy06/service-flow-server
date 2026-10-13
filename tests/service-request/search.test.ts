import { jest } from "@jest/globals";

const rows = [
  { id: "pending-a", organizationId: "org-a", referenceNumber: "SR-001", title: "Air conditioner repair", status: "PENDING", customer: { organizationId: "org-a", name: "Alice Santos" } },
  { id: "progress-a", organizationId: "org-a", referenceNumber: "SR-002", title: "Air conditioner repair", status: "IN_PROGRESS", customer: { organizationId: "org-a", name: "Alice Santos" } },
  { id: "closed-a", organizationId: "org-a", referenceNumber: "SR-003", title: "Air conditioner repair", status: "COMPLETED", customer: { organizationId: "org-a", name: "Alice Santos" } },
  { id: "pending-b", organizationId: "org-b", referenceNumber: "SR-004", title: "Air conditioner repair", status: "PENDING", customer: { organizationId: "org-b", name: "Alice Santos" } },
];
function matches(row: typeof rows[number], where: any): boolean {
  return (!where.organizationId || row.organizationId === where.organizationId) &&
    (!where.status || row.status === where.status) &&
    (!where.referenceNumber || row.referenceNumber.includes(where.referenceNumber.contains)) &&
    (!where.title || row.title.includes(where.title.contains)) &&
    (!where.customer || row.customer.organizationId === where.customer.organizationId && row.customer.name.includes(where.customer.name.contains)) &&
    (!where.OR || where.OR.some((clause: any) => matches(row, clause)));
}
const db = {
  serviceRequest: {
    count: jest.fn(async ({ where }: any) => rows.filter((row) => matches(row, where)).length),
    findMany: jest.fn(async ({ where, skip, take }: any) => rows.filter((row) => matches(row, where)).slice(skip, skip + take)),
  },
  $transaction: jest.fn(async (work: any) => work(db)),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: {} }));
const { requestContext } = await import("@/lib/requestContext.js");
const { serviceRequestService } = await import("@/modules/service-request/service-request.service.js");
const { requestListInput } = await import("@/modules/service-request/service-request.schema.js");
const search = (query: Record<string, unknown>, organizationId: string | null = "org-a") => requestContext.run(
  { requestId: "search-test", organizationId: organizationId ?? undefined },
  () => serviceRequestService.list(requestListInput.parse({ query }).query),
);
beforeEach(() => jest.clearAllMocks());

test.each(["SR-001", "Air conditioner", "Alice"])("finds pending requests by reference, title or customer: %s", async (term) => {
  const result = await search({ search: term, status: "PENDING", organizationId: "org-b" });
  expect(result.requests.map((row) => row.id)).toEqual(["pending-a"]);
  expect(result.pagination.total).toBe(1);
});

test("title search honors the in-progress filter and tenant ownership", async () => {
  expect((await search({ search: "repair", status: "IN_PROGRESS" })).requests.map((row) => row.id)).toEqual(["progress-a"]);
  expect((await search({ search: "repair", status: "PENDING" }, "org-b")).requests.map((row) => row.id)).toEqual(["pending-b"]);
});

test("empty title searches keep valid pagination and do not leak foreign matches", async () => {
  const result = await search({ search: "SR-004", status: "PENDING", page: 99 });
  expect(result.requests).toEqual([]);
  expect(result.pagination).toMatchObject({ total: 0, page: 1, totalPages: 1 });
});

test("requires a trusted organization context before searching", async () => {
  await expect(search({ search: "repair", organizationId: "org-b" }, null)).rejects.toThrow("An organization session is required");
  expect(db.serviceRequest.count).not.toHaveBeenCalled();
});
