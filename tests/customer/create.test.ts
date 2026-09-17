// tests/modules/customer/create.test.ts
import {
  prisma,
  auditService,
  requestContext,
  getOrSetCache,
  invalidateCache,
  resetMocks,
  mockCustomer,
  ORG_ID,
} from "./__mocks__/setup.js";

const { customerService } =
  await import("@/modules/customer/customer.service.js");

describe("customerService.create", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("creates customer", async () => {
    const input = {
      firstName: "Juan",
      lastName: "Dela Cruz",
      email: "juan@test.com",
      phoneNumber: "09171234567",
    };
    const created = mockCustomer(input);
    (prisma.customer.create as jest.Mock).mockResolvedValue(created);

    const result = await customerService.create(input);

    expect(result).toEqual(created);
  });
});
