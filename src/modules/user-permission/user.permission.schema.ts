import z from "zod";
import { permissionIdsSchema, resourceId } from "@/modules/role/role.schema.js";
export const userPermissionParamsSchema = z.object({ params: z.object({ userId: resourceId }) });
export const permissionOverrideSchema = z.object({
  permissionId: resourceId,
  state: z.enum(["inherit", "grant", "deny"]),
}).strict();
const overridesSchema = z.array(permissionOverrideSchema).min(1).max(200)
  .refine((overrides) => new Set(overrides.map((override) => override.permissionId)).size === overrides.length, "Duplicate permission IDs");
export const userPermissionUpdateBody = z.union([
  z.object({ overrides: overridesSchema }).strict(),
  // Preserve existing callers: replace explicit grants while retaining unrelated denials.
  z.object({ permissionIds: permissionIdsSchema }).strict(),
]);
export type UserPermissionUpdate = z.infer<typeof userPermissionUpdateBody>;
export type PermissionOverride = z.infer<typeof permissionOverrideSchema>;
export const updateUserPermissionSchema = z.object({
  params: z.object({ userId: resourceId }),
  body: userPermissionUpdateBody,
});
