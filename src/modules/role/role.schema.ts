import z from "zod";

export const resourceId = z.string().trim().min(1).max(64);
export const permissionIdsSchema = z.array(resourceId).max(200).refine(
  (ids) => new Set(ids).size === ids.length, "Duplicate permission IDs are not allowed",
);
const roleName = z.string().trim().min(2, "Role name must have at least 2 characters").max(80);
export const roleParamsSchema = z.object({ params: z.object({ id: resourceId }) });
export const listRolesSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(120).default(""),
    sortBy: z.enum(["name"]).default("name"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
    deleted: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  }).strict(),
});
export const restoreRoleSchema = z.object({
  params: z.object({ id: resourceId }),
  body: z.object({ name: roleName.optional() }).strict().default({}),
});
export const createRoleSchema = z.object({
  body: z.object({ name: roleName, permissionIds: permissionIdsSchema.default([]) }).strict(),
});
export const updateRoleSchema = z.object({
  params: z.object({ id: resourceId }),
  body: z.object({ name: roleName.optional(), permissionIds: permissionIdsSchema.optional() })
    .strict().refine((body) => body.name !== undefined || body.permissionIds !== undefined, "Provide changes to update"),
});
export type CreateRoleSchema = z.infer<typeof createRoleSchema>["body"];
export type UpdateRoleSchema = z.infer<typeof updateRoleSchema>["body"];
export type ListRolesQuery = z.infer<typeof listRolesSchema>["query"];
export type RestoreRoleInput = z.infer<typeof restoreRoleSchema>["body"];
