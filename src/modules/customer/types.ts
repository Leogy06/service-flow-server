export type CreateCustomerInput = {
  name: string;
  email: string;
  phoneNumber: string;
  address?: string;
  notes?: string;
  customerType: string;
  organizationId?: string;
};
