export type UserBase = {
  id: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  email: string;
  phone: string;
  organizationId: string;
  roleId: string;
  password?: string;
};

// Create — no id (auto-gen), organizationId optional (system admin case, no org)
export type UserCreateInput = Omit<UserBase, "id" | "organizationId"> & {
  organizationId?: string;
};

// Update — everything optional except keep organizationId/roleId separate (admin-only change)
export type UserUpdateInput = Partial<
  Omit<UserBase, "id" | "organizationId" | "roleId">
>;

// Separate type for org/role reassignment — admin-only action, not regular update
export type UserOrgRoleUpdateInput = {
  organizationId?: string;
  roleId?: string;
};
