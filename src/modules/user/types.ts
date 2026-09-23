export type UserUpdateInput = {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  email: string;
  phone: string;
  organizationId: string;
  roleId: string;
};
