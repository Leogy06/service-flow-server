// tests/modules/customer/__mocks__/setup.ts
import { prisma } from "@/lib/prisma.js";
import { auditService } from "@/modules/audit/audit.service.js";
import { requestContext } from "@/lib/requestContext.js";
import { getOrSetCache, invalidateCache } from "@/utils/cache.js";

jest.mock("@/lib/prisma.js", () => ({
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

jest.mock("@/modules/audit/audit.service.js", () => ({
  auditService: { record: jest.fn() },
}));

jest.mock("@/lib/requestContext.js", () => ({
  requestContext: { getValue: jest.fn() },
}));

jest.mock("@/utils/cache.js", () => ({
  DEFAULT_TTL_SECONDS: 60,
  getOrSetCache: jest.fn(),
  invalidateCache: jest.fn(),
}));

export const ORG_ID = "org-1";

export function resetMocks() {
  jest.clearAllMocks();
  (requestContext.getValue as jest.Mock).mockReturnValue(ORG_ID);
}

export function mockCustomer(overrides = {}) {
  return {
    id: "cust-1",
    firstName: "Juan",
    lastName: "Dela Cruz",
    email: "juan@test.com",
    phoneNumber: "09171234567",
    organizationId: ORG_ID,
    deletedAt: null,
    ...overrides,
  };
}

export { prisma, auditService, requestContext, getOrSetCache, invalidateCache };