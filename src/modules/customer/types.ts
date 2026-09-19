export type CreateCustomerInput = {
  name:string
  email: string;
  phoneNumber: string;
  customerType: "INDIVIDUAL" | "ORGANIZATION";
  organizationName?: string;
  organizationId: string;
};
