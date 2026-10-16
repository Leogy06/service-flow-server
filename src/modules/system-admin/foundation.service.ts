import type { Prisma } from "@/generated/prisma/client.js";
import { prisma } from "@/lib/prisma.js";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
import { AppError } from "@/utils/AppError.js";
import { pagination } from "@/utils/tenant-transaction.js";
import { recordPlatformAudit, platformTransaction, lockOrganization } from "./platform-audit.js";
import type { TenantListQuery, UserListQuery, UserRoleListQuery, AuditListQuery, TenantStatusInput, UserSecurityInput, RevokeSessionsInput } from "./foundation.schema.js";
const tenantSelect = {
  id: true, name: true, slug: true, status: true, billingEnabled: true, createdAt: true, updatedAt: true,
  statusReason: true, statusChangedAt: true, statusChangedBy: true,
  subscription: { include: { plan: true } },
  _count: { select: { users: { where: { deletedAt: null, status: "ACTIVE", platformRole: "NONE" } }, customers: true, serviceRequests: true } },
} satisfies Prisma.OrganizationSelect;
const userSelect = {
  id: true, email: true, firstName: true, lastName: true, middleName: true, suffix: true,
  phone: true, organizationId: true, status: true, securityStatus: true, securityReason: true,
  securityChangedAt: true, securityChangedBy: true, sessionVersion: true, createdAt: true, updatedAt: true,
  organization: { select: { id: true, name: true, slug: true, status: true } },
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;
const tenantAccount = { platformRole: "NONE" as const, organizationId: { not: null }, deletedAt: null };
async function findTenantUser(db: Prisma.TransactionClient, id: string) {
  const user = await db.user.findFirst({ where: { id, ...tenantAccount }, select: userSelect });
  if (!user) throw new AppError(404, "Tenant user not found");
  return user;
}
export const foundationService = {
  async userRoles(query: UserRoleListQuery) {
    await requirePlatformAuthority();
    const where: Prisma.RoleWhereInput = { deletedAt: null, organizationId: query.organizationId ?? { not: null },
      ...(query.search ? { name: { contains: query.search } } : {}) };
    return prisma.$transaction(async (db) => {
      const paging = pagination(query.page, query.pageSize, await db.role.count({ where }));
      const items = await db.role.findMany({ where, select: { id: true, name: true, organization: { select: { id: true, name: true, slug: true } } },
        orderBy: [{ name: "asc" }, { id: "asc" }], skip: (paging.page - 1) * paging.pageSize, take: paging.pageSize });
      return { items, pagination: paging };
    }, { isolationLevel: "RepeatableRead" });
  },
  async tenants(query: TenantListQuery) {
    await requirePlatformAuthority();
    const where: Prisma.OrganizationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.subscriptionStatus ? { subscription: { is: { status: query.subscriptionStatus } } } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search } }, { slug: { contains: query.search } }] } : {}),
    };
    return prisma.$transaction(async (db) => {
      const total = await db.organization.count({ where });
      const page = pagination(query.page, query.pageSize, total);
      const items = await db.organization.findMany({ where, select: tenantSelect,
        orderBy: [query.sortBy === "expiresAt" ? { subscription: { expiresAt: query.sortOrder } } : { [query.sortBy]: query.sortOrder }, { id: query.sortOrder }], skip: (page.page - 1) * page.pageSize, take: page.pageSize });
      return { items: items.map((tenant) => ({ ...tenant, activeUserCount: tenant._count.users })), pagination: page };
    }, { isolationLevel: "RepeatableRead" });
  },
  async tenant(id: string) {
    await requirePlatformAuthority();
    const tenant = await prisma.organization.findUnique({ where: { id }, select: { ...tenantSelect,
      subscription: { include: { plan: true, history: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 } } },
      subscriptionPayments: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { refund: true } },
    } });
    if (!tenant) throw new AppError(404, "Tenant not found");
    const auditLogs = await prisma.auditLog.findMany({ where: { scope: "PLATFORM", organizationId: id },
      select: { id: true, action: true, entity: true, entityId: true, createdAt: true, metadata: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
    return { ...tenant, activeUserCount: tenant._count.users, payments: tenant.subscriptionPayments, auditLogs };
  },
  async users(query: UserListQuery) {
    await requirePlatformAuthority();
    const where: Prisma.UserWhereInput = {
      ...tenantAccount, ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.roleId ? { roleId: query.roleId } : {}),
      ...(query.status ? { status: query.status } : {}), ...(query.securityStatus ? { securityStatus: query.securityStatus } : {}),
      ...(query.search ? { OR: [{ firstName: { contains: query.search } }, { lastName: { contains: query.search } }, { email: { contains: query.search } }] } : {}),
    };
    return prisma.$transaction(async (db) => {
      const total = await db.user.count({ where });
      const page = pagination(query.page, query.pageSize, total);
      const items = await db.user.findMany({ where, select: userSelect,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }], skip: (page.page - 1) * page.pageSize, take: page.pageSize });
      return { items, pagination: page };
    }, { isolationLevel: "RepeatableRead" });
  },
  async user(id: string) {
    await requirePlatformAuthority();
    const user = await findTenantUser(prisma, id);
    const activeSessions = await prisma.refreshToken.count({ where: { userId: id, expiresAt: { gt: new Date() } } });
    const auditLogs = await prisma.auditLog.findMany({ where: { scope: "PLATFORM", entity: "User", entityId: id },
      select: { id: true, action: true, entity: true, entityId: true, createdAt: true, metadata: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
    return { ...user, activeSessions, activeSessionCount: activeSessions, auditLogs };
  },
  async auditLogs(query: AuditListQuery) {
    await requirePlatformAuthority();
    const where: Prisma.AuditLogWhereInput = { scope: "PLATFORM",
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.action ? { action: query.action } : {}), ...(query.entity ? { entity: query.entity } : {}),
      ...(query.search ? { OR: [{ action: { contains: query.search } }, { entity: { contains: query.search } }, { entityId: { contains: query.search } }] } : {}),
    };
    return prisma.$transaction(async (db) => {
      const total = await db.auditLog.count({ where });
      const page = pagination(query.page, query.pageSize, total);
      const items = await db.auditLog.findMany({ where, select: {
        id: true, action: true, entity: true, entityId: true, organizationId: true, actorType: true,
        createdAt: true, metadata: true, requestId: true, ipAddress: true, userAgent: true,
        actor: { select: { id: true, firstName: true, lastName: true } },
      }, orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }], skip: (page.page - 1) * page.pageSize, take: page.pageSize });
      return { items, pagination: page };
    }, { isolationLevel: "RepeatableRead" });
  },
  async tenantStatus(id: string, input: TenantStatusInput) {
    return platformTransaction(async (db) => {
      const actor = await requirePlatformAuthority(db);
      await lockOrganization(db, id);
      const before = await db.organization.findUnique({ where: { id }, select: tenantSelect });
      if (!before) throw new AppError(404, "Tenant not found");
      if (before.status === input.status) throw new AppError(409, "Tenant already has this status");
      const result = await db.organization.update({ where: { id }, data: {
        status: input.status, statusReason: input.reason, statusChangedAt: new Date(), statusChangedBy: actor.id,
      }, select: tenantSelect });
      await db.user.updateMany({ where: { organizationId: id }, data: { sessionVersion: { increment: 1 } } });
      const revoked = await db.refreshToken.deleteMany({ where: { organizationId: id } });
      await recordPlatformAudit(db, { action: "tenant.status.changed", entity: "Organization", entityId: id, organizationId: id,
        before: { status: before.status }, after: { status: input.status, reason: input.reason, sessionsRevoked: revoked.count } });
      return result;
    });
  },
  async userSecurity(id: string, input: UserSecurityInput) {
    return platformTransaction(async (db) => {
      const actor = await requirePlatformAuthority(db);
      const initial = await findTenantUser(db, id);
      await lockOrganization(db, initial.organizationId!);
      const before = await findTenantUser(db, id);
      if (before.securityStatus === input.securityStatus) throw new AppError(409, "User already has this security status");
      const result = await db.user.update({ where: { id, organizationId: before.organizationId, platformRole: "NONE", deletedAt: null }, data: {
        securityStatus: input.securityStatus, securityReason: input.reason, securityChangedAt: new Date(), securityChangedBy: actor.id,
        sessionVersion: { increment: 1 },
      }, select: userSelect });
      const revoked = await db.refreshToken.deleteMany({ where: { userId: id } });
      await recordPlatformAudit(db, { action: "user.security.changed", entity: "User", entityId: id, organizationId: before.organizationId!,
        before: { securityStatus: before.securityStatus }, after: { securityStatus: input.securityStatus, reason: input.reason, sessionsRevoked: revoked.count } });
      return result;
    });
  },
  async revokeSessions(id: string, input: RevokeSessionsInput) {
    return platformTransaction(async (db) => {
      await requirePlatformAuthority(db);
      const initial = await findTenantUser(db, id);
      await lockOrganization(db, initial.organizationId!);
      const before = await findTenantUser(db, id);
      await db.user.update({ where: { id, organizationId: before.organizationId, platformRole: "NONE", deletedAt: null }, data: { sessionVersion: { increment: 1 } }, select: { id: true } });
      const revoked = await db.refreshToken.deleteMany({ where: { userId: id } });
      await recordPlatformAudit(db, { action: "user.sessions.revoked", entity: "User", entityId: id, organizationId: before.organizationId!, after: { reason: input.reason, sessionsRevoked: revoked.count } });
      return { sessionsRevoked: revoked.count };
    });
  },
};
