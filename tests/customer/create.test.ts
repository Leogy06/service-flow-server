// tests/modules/customer/create.test.ts
import {
  prisma,
  // auditService,
  // requestContext,
  // getOrSetCache,
  // invalidateCache,
  ORG_ID,
  resetMocks,
  mockCustomer,
} from "./__mocks__/setup.js";

const { customerService } =
  await import("@/modules/customer/customer.service.js");

describe("customerService.create", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("creates individual customer", async () => {
    const input = {
      firstName: "Juan",
      lastName: "Dela Cruz",
      email: "juan@test.com",
      phoneNumber: "09171234567",
      customerType: "INDIVIDUAL" as const,
      organizationId: ORG_ID,
    };
    const created = mockCustomer(input);
    (prisma.customer.create as jest.Mock).mockResolvedValue(created);

    const result = await customerService.create(input);

    expect(result).toEqual(created);
  });

  it("creates organization customer", async () => {
    const input = {
      organizationName: "Test Organization",
      email: "test@email.com",
      phoneNumber: "09171234777",
      customerType: "ORGANIZATION" as const,
      organizationId: ORG_ID,
    };

    const created = mockCustomer(input);
    (prisma.customer.create as jest.Mock).mockResolvedValue(created);

    const result = await customerService.create(input);

    expect(result).toEqual(created);

    console.log("RESULT:", result);
    console.log("EXPECTED:", created);
  });

  it("failes because no customer type", async () => {
    const input = {
      id: "cust-1",
      email: "juan@test.com",
      phoneNumber: "09171234567",
      organizationId: ORG_ID,
    };

    await expect(customerService.create(input as any)).rejects.toThrow(
      "Customer type is required.",
    );
  });
});
