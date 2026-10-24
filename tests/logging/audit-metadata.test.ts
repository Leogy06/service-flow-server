import { jest } from "@jest/globals";
const create = jest.fn(async (_args: unknown) => ({}));
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: { auditLog: { create } } }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger: { error: jest.fn() } }));
jest.unstable_mockModule("@/modules/role/tenant-access-policy.js", () => ({ isTenantAdminName: (role: string) => role === "Admin" }));
const { auditService } = await import("@/modules/audit/audit.service.js");
const { requestContext } = await import("@/lib/requestContext.js");
const { prisma } = await import("@/lib/prisma.js");

test.each(["x".repeat(500), "😀".repeat(500)])("audit writers bound valid long header metadata without splitting Unicode", async userAgent => {
  const event = { action: "test", entity: "Customer", entityId: "fixture" };
  await requestContext.run({ requestId: "request", userAgent }, async () => {
    await auditService.recordInTransaction(prisma, event);
    await auditService.record(event);
  });
  expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ userAgent: Array.from(userAgent).slice(0, 191).join("") }) });
  for (const [args] of create.mock.calls) {
    expect(Array.from((args as { data: { userAgent: string } }).data.userAgent).length).toBeLessThanOrEqual(191);
  }
});
