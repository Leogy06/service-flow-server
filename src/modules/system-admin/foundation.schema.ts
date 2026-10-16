import { z } from "zod";
const id = z.string().trim().min(1).max(100);
const paging = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
};
export const tenantListSchema = z.object({ query: z.object({
  ...paging, status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
  subscriptionStatus: z.enum(["PENDING", "ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED"]).optional(),
  sortBy: z.enum(["name", "createdAt", "status", "expiresAt"]).default("createdAt"),
}).strict() });
export const userListSchema = z.object({ query: z.object({
  ...paging, organizationId: id.optional(), roleId: id.optional(), status: z.enum(["ACTIVE", "PENDING"]).optional(),
  securityStatus: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  sortBy: z.enum(["firstName", "lastName", "email", "createdAt", "status"]).default("createdAt"),
}).strict() });
export const userRoleListSchema = z.object({ query: z.object({ ...paging, organizationId: id.optional() }).strict() });
export type UserRoleListQuery = z.infer<typeof userRoleListSchema>["query"];
export const auditListSchema = z.object({ query: z.object({
  ...paging, action: z.string().trim().min(1).max(100).optional(),
  entity: z.string().trim().min(1).max(100).optional(), organizationId: id.optional(),
}).strict() });
export const detailSchema = z.object({ params: z.object({ id }).strict() });
const mutation = { reason: z.string().trim().min(3).max(1000), confirm: z.literal(true) };
export const tenantStatusSchema = z.object({ params: z.object({ id }), body: z.object({
  ...mutation, status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]),
}).strict() });
export const userSecuritySchema = z.object({ params: z.object({ id }), body: z.object({
  ...mutation, securityStatus: z.enum(["ACTIVE", "BLOCKED"]),
}).strict() });
export const revokeSessionsSchema = z.object({ params: z.object({ id }), body: z.object(mutation).strict() });
export type TenantListQuery = z.infer<typeof tenantListSchema>["query"];
export type UserListQuery = z.infer<typeof userListSchema>["query"];
export type AuditListQuery = z.infer<typeof auditListSchema>["query"];
export type TenantStatusInput = z.infer<typeof tenantStatusSchema>["body"];
export type UserSecurityInput = z.infer<typeof userSecuritySchema>["body"];
export type RevokeSessionsInput = z.infer<typeof revokeSessionsSchema>["body"];
