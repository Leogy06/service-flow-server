// tests/modules/customer/__mocks__/setup.ts
import { jest } from "@jest/globals";

export const ORG_ID = "org-1";

jest.unstable_mockModule("@/lib/prisma.js", () => ({
  prisma: {
    customer: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({
  auditService: { record: jest.fn() },
}));

jest.unstable_mockModule("@/lib/requestContext.js", () => ({
  requestContext: { getValue: jest.fn() },
}));

jest.unstable_mockModule("@/utils/cache.js", () => ({
  DEFAULT_TTL_SECONDS: 60,
  getOrSetCache: jest.fn(),
  invalidateCache: jest.fn(),
}));

// dynamic import AFTER mocks registered
export const { prisma } = await import("@/lib/prisma.js");
export const { auditService } =
  await import("@/modules/audit/audit.service.js");
export const { requestContext } = await import("@/lib/requestContext.js");
export const { getOrSetCache, invalidateCache } =
  await import("@/utils/cache.js");

export function resetMocks() {
  jest.clearAllMocks();
  (requestContext.getValue as jest.Mock).mockReturnValue(ORG_ID);
}

export function mockCustomer(overrides = {}) {
  return {
    id: "cust-1",
    email: "juan@test.com",
    phoneNumber: "09171234567",
    organizationId: ORG_ID,
    deletedAt: null,
    ...overrides,
  };
}
