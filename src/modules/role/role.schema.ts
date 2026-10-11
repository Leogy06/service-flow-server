import z from "zod";

export const resourceId = z.string().trim().min(1).max(64);
export const permissionIdsSchema = z.array(resourceId).max(200).refine(
  (ids) => new Set(ids).size === ids.length, "Duplicate permission IDs are not allowed",
);
const roleName = z.string().trim().min(2, "Role name must have at least 2 characters").max(80);
export const roleParamsSchema = z.object({ params: z.object({ id: resourceId }) });
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