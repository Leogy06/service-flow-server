import z from "zod";

export const createRolePermissionSchema = z.object({
  body: z.object({
    roleId: z.string().min(1, "Role ID is required"),
    permissionId: z.string().min(1, "Permission ID is required"),
  }),
});

export const updateRolePermission = z.object({
  body: z.object({
    permissions: z
      .array(z.cuid2())
      .default([])
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate permission IDs are not allowed",
      ),
  }),
});

export type CreateRolePermissionSchema = z.infer<
  typeof createRolePermissionSchema
>["body"];

export type UpdateRolePermissionSchema = z.infer<
  typeof updateRolePermission
>["body"];
