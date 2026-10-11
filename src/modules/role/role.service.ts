import { prisma } from "@/lib/prisma.js";
import { auditService } from "@/modules/audit/audit.service.js";
import { AppError } from "@/utils/AppError.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import {
  accessTransaction, findTenantRole, isReservedRoleName, managedRoleSelect,
  requireAssignableRole, requireTenantAdmin, roleIsProtected, validateGrants,
  type ManagedRole, type TenantActor,
} from "./tenant-access-policy.js";

function view(role: ManagedRole, actor: TenantActor) {
  const protectedRole = roleIsProtected(role, actor);
  return {
    id: role.id, name: role.name, organizationId: role.organizationId,
    permissions: role.permissions.filter(({ permission: p }) => p.organizationId === null || p.organizationId === actor.organizationId)
      .map((grant) => ({ id: grant.permission.id, name: grant.permission.name })),
    userCount: role._count.users, protected: protectedRole, assignable: !protectedRole,
  };
}

export const roleService = {
  async list() {
    const actor = await requireTenantAdmin(prisma, PERMISSIONS.ROLE_READ);
    const roles = await prisma.role.findMany({
      where: { organizationId: actor.organizationId }, select: managedRoleSelect, orderBy: { name: "asc" },
    });
    return roles.map((role) => view(role, actor));
  },
  async listAssignable() {
    const actor = await requireTenantAdmin(prisma, [PERMISSIONS.USER_CREATE, PERMISSIONS.USER_UPDATE]);
    const roles = await prisma.role.findMany({
      where: { organizationId: actor.organizationId }, select: managedRoleSelect, orderBy: { name: "asc" },
    });
    return roles.filter((role) => !roleIsProtected(role, actor)).map((role) => ({ id: role.id, name: role.name, assignable: true }));
  },
  async getById(id: string) {
    const actor = await requireTenantAdmin(prisma, PERMISSIONS.ROLE_READ);
    return view(await findTenantRole(prisma, id, actor), actor);
  },
  async create(input: { name: string; permissionIds: string[] }) {
    const role = await accessTransaction(async (db) => {
      const actor = await requireTenantAdmin(db, PERMISSIONS.ROLE_CREATE);
      if (isReservedRoleName(input.name)) throw new AppError(403, "This role name is reserved");
      await validateGrants(db, input.permissionIds, actor);
      const created = await db.role.create({ data: {
        name: input.name, organizationId: actor.organizationId,
        permissions: { create: input.permissionIds.map((permissionId) => ({ permissionId, isActive: true })) },
      }, select: managedRoleSelect });
      const after = view(created, actor);
      await auditService.recordInTransaction(db, { action: "create.role.success", entity: "Role", entityId: created.id, after });
      return after;
    });
    return role;
  },
  async update(id: string, input: { name?: string; permissionIds?: string[] }) {
    const result = await accessTransaction(async (db) => {
      const actor = await requireTenantAdmin(db, PERMISSIONS.ROLE_UPDATE);
      const before = await requireAssignableRole(db, id, actor);
      if (input.name && isReservedRoleName(input.name)) throw new AppError(403, "This role name is reserved");
      if (input.permissionIds !== undefined) {
        await validateGrants(db, input.permissionIds, actor);
        await db.rolePermission.updateMany({ where: { roleId: id }, data: { isActive: false } });
        for (const permissionId of input.permissionIds) {
          await db.rolePermission.upsert({
            where: { roleId_permissionId: { roleId: id, permissionId } },
            create: { roleId: id, permissionId, isActive: true }, update: { isActive: true },
          });
        }
      }
      const after = await db.role.update({
        where: { id, organizationId: actor.organizationId },
        data: input.name === undefined ? {} : { name: input.name }, select: managedRoleSelect,
      });
      const change = { before: view(before, actor), after: view(after, actor) };
      await auditService.recordInTransaction(db, { action: "update.role.success", entity: "Role", entityId: after.id, ...change });
      return change;
    });
    return result.after;
  },
  async addPermission(id: string, permissionId: string) {
    const result = await accessTransaction(async (db) => {
      const actor = await requireTenantAdmin(db, PERMISSIONS.ROLE_UPDATE);
      const before = await requireAssignableRole(db, id, actor);
      await validateGrants(db, [permissionId], actor);
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: id, permissionId } },
        create: { roleId: id, permissionId, isActive: true }, update: { isActive: true },
      });
      const change = { before: view(before, actor), after: view(await findTenantRole(db, id, actor), actor) };
      await auditService.recordInTransaction(db, { action: "update.role.permissions.success", entity: "Role", entityId: before.id, ...change });
      return change;
    });
    return result.after.permissions.map((permission) => ({ permission }));
  },
  async delete(id: string) {
    const before = await accessTransaction(async (db) => {
      const actor = await requireTenantAdmin(db, PERMISSIONS.ROLE_DELETE);
      const role = await requireAssignableRole(db, id, actor);
      if (role._count.users) throw new AppError(409, "Assign users to another role before deleting this role");
      await db.rolePermission.deleteMany({ where: { roleId: id } });
      await db.role.delete({ where: { id, organizationId: actor.organizationId } });
      const snapshot = view(role, actor);
      await auditService.recordInTransaction(db, { action: "delete.role.success", entity: "Role", entityId: role.id, before: snapshot });
      return snapshot;
    });
    return { id: before.id };
  },
};
