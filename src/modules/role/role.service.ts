import { prisma } from "@/lib/prisma.js";
import { auditService } from "@/modules/audit/audit.service.js";
import { AppError } from "@/utils/AppError.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import type { Prisma } from "@/generated/prisma/client.js";
import type { ListRolesQuery, RestoreRoleInput } from "./role.schema.js";
import { isPlatformPermissionName } from "@/modules/auth/authorization.js";
import {
  accessTransaction, findTenantRole, isReservedRoleName, managedRoleSelect,
  requireAssignableRole, requireTenantAdmin, roleIsProtected, validateGrants,
  type ManagedRole, type TenantActor,
} from "./tenant-access-policy.js";

function view(role: ManagedRole, actor: TenantActor) {
  const protectedRole = roleIsProtected(role, actor);
  return {
    id: role.id, name: role.name, organizationId: role.organizationId, deletedAt: role.deletedAt,
    permissions: role.permissions.filter(({ permission: p }) => !isPlatformPermissionName(p.name) && (p.organizationId === null || p.organizationId === actor.organizationId))
      .map((grant) => ({ id: grant.permission.id, name: grant.permission.name })),
    userCount: role._count.users, protected: protectedRole, assignable: !protectedRole && !role.deletedAt,
  };
}

async function requireAvailableName(db: Prisma.TransactionClient, organizationId: string, name: string, id?: string) {
  // Archived names remain reserved by the existing organization/name unique constraint.
  const conflict = await db.role.findFirst({ where: {
    organizationId, name, ...(id ? { NOT: { id } } : {}),
  }, select: { id: true } });
  if (conflict) throw new AppError(409, "A role with this name already exists in your organization, including archived roles");
}

export const roleService = {
  async list(query: ListRolesQuery) {
    const actor = await requireTenantAdmin(prisma, PERMISSIONS.ROLE_READ);
    return prisma.$transaction(async (db) => {
      const where: Prisma.RoleWhereInput = {
        organizationId: actor.organizationId,
        deletedAt: query.deleted ? { not: null } : null,
        ...(query.search ? { name: { contains: query.search } } : {}),
      };
      const total = await db.role.count({ where });
      const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
      const page = Math.min(query.page, totalPages);
      const roles = await db.role.findMany({
        where, select: managedRoleSelect,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        skip: (page - 1) * query.pageSize, take: query.pageSize,
      });
      return { roles: roles.map((role) => view(role, actor)), pagination: {
        page, pageSize: query.pageSize, total, totalPages,
        hasNextPage: page < totalPages, hasPreviousPage: page > 1,
      } };
    }, { isolationLevel: "RepeatableRead" });
  },
  async listAssignable() {
    const actor = await requireTenantAdmin(prisma, [PERMISSIONS.USER_CREATE, PERMISSIONS.USER_UPDATE]);
    const roles = await prisma.role.findMany({
      where: { organizationId: actor.organizationId, deletedAt: null }, select: managedRoleSelect, orderBy: { name: "asc" },
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
      await requireAvailableName(db, actor.organizationId, input.name);
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
      if (input.name !== undefined) await requireAvailableName(db, actor.organizationId, input.name, id);
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
    return accessTransaction(async (db) => {
      const actor = await requireTenantAdmin(db, PERMISSIONS.ROLE_DELETE);
      const role = await requireAssignableRole(db, id, actor);
      if (role._count.users) throw new AppError(409, "Assign users to another role before deleting this role");
      const archived = await db.role.update({
        where: { id, organizationId: actor.organizationId, deletedAt: null },
        data: { deletedAt: new Date() }, select: managedRoleSelect,
      });
      const after = view(archived, actor);
      await auditService.recordInTransaction(db, {
        action: "delete.role.success", entity: "Role", entityId: role.id, before: view(role, actor), after,
      });
      return after;
    });
  },
  async restore(id: string, input: RestoreRoleInput) {
    return accessTransaction(async (db) => {
      const actor = await requireTenantAdmin(db, PERMISSIONS.ROLE_UPDATE);
      const role = await findTenantRole(db, id, actor, true);
      if (roleIsProtected(role, actor)) throw new AppError(403, "Role is protected or outside your grantable authority");
      const name = input.name ?? role.name;
      if (isReservedRoleName(name)) throw new AppError(403, "This role name is reserved");
      await requireAvailableName(db, actor.organizationId, name, id);
      await validateGrants(db, role.permissions.map((grant) => grant.permission.id), actor);
      const restored = await db.role.update({
        where: { id, organizationId: actor.organizationId, deletedAt: { not: null } },
        data: { name, deletedAt: null }, select: managedRoleSelect,
      });
      const after = view(restored, actor);
      await auditService.recordInTransaction(db, {
        action: "restore.role.success", entity: "Role", entityId: id, before: view(role, actor), after,
      });
      return after;
    });
  },
};
