import { TENANT_GRANTABLE_PERMISSIONS } from "./tenant-grantable-permissions";
import { PERMISSIONS } from "./permission.constants";

export const TENANT_ADMIN_PERMISSIONS: readonly string[] = [
  ...TENANT_GRANTABLE_PERMISSIONS,
  PERMISSIONS.USER_CREATE,
  PERMISSIONS.USER_READ,
  PERMISSIONS.USER_UPDATE,
  PERMISSIONS.USER_DELETE,
  PERMISSIONS.ROLE_CREATE,
  PERMISSIONS.ROLE_READ,
  PERMISSIONS.ROLE_UPDATE,
  PERMISSIONS.ROLE_DELETE,
];

export const DEFAULT_ROLE_DEFINITIONS = [
  { name: "Admin", permissionNames: TENANT_ADMIN_PERMISSIONS },
  {
    name: "Manager",
    permissionNames: TENANT_GRANTABLE_PERMISSIONS.filter(
      (name) => !name.endsWith(":delete"),
    ),
  },
  {
    name: "Staff",
    permissionNames: TENANT_GRANTABLE_PERMISSIONS.filter(
      (name) => name.endsWith(":read") || name.endsWith(":update"),
    ),
  },
] as const;
