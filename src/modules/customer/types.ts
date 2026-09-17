export type CreateCustomerInput = {
  firstName?: string;
  lastName?: string;
  email: string;
  middleName?: string;
  suffix?: string;
  phoneNumber: string;
  customerType: "INDIVIDUAL" | "ORGANIZATION";
  organizationName?: string;
  organizationId: string;
};
