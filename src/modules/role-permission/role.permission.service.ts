import { roleService } from "@/modules/role/role.service.js";

// Keep the existing endpoints on the same guarded role mutation path.
export const rolePermissionService = {
  async list(roleId: string) {
    const role = await roleService.getById(roleId);
    return role.permissions.map((p) => ({ roleName: role.name, permissionName: p.name }));
  },
  async create({ roleId, permissionId }: { roleId: string; permissionId: string }) {
    return roleService.addPermission(roleId, permissionId);
  },
  async update(roleId: string, permissionIds: string[]) {
    const role = await roleService.update(roleId, { permissionIds });
    return role.permissions.map((permission) => ({ permission }));
  },
};
