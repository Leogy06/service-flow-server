import {
  prisma,
  // auditService,
  // requestContext,
  // getOrSetCache,
  // invalidateCache,
  ORG_ID,
  requestContext,
  resetMocks,
  mockCustomer,
} from "./__mocks__/setup.js";

const { customerService } =
  await import("@/modules/customer/customer.service.js");

describe("customerService.create", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("creates a customer in the authenticated organization", async () => {
    const input = {
      name: "Juan Dela Cruz",
      email: "juan@test.com",
      phoneNumber: "09171234567",
      organizationId: ORG_ID,
    };
    const created = mockCustomer(input);
    (prisma.customer.create as jest.Mock).mockResolvedValue(created);

    const result = await customerService.create(input);

    expect(result).toEqual(created);
  });

  it("creates a customer with an organization name", async () => {
    const input = {
      name: "Test Organization",
      email: "test@email.com",
      phoneNumber: "09171234777",
      organizationId: ORG_ID,
    };

    const created = mockCustomer(input);
    (prisma.customer.create as jest.Mock).mockResolvedValue(created);

    const result = await customerService.create(input);

    expect(result).toEqual(created);

  });

  it("rejects creation without a trusted organization context", async () => {
    (requestContext.getValue as jest.Mock).mockReturnValue(undefined);
    const input = {
      name: "Juan Dela Cruz",
      email: "juan@test.com",
      phoneNumber: "09171234567",
      organizationId: ORG_ID,
    };

    await expect(customerService.create(input)).rejects.toThrow(
      "Organization context is required",
    );
  });
});
