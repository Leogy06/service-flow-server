import z from "zod";

export const createRolePermissionSchema = z.object({
  body: z.object({
    roleId: z.string().min(1, "Role ID is required"),
    permissionId: z.string().min(1, "Permission ID is required"),
  }),
});

export type CreatePermissionSchema = z.infer<
  typeof createRolePermissionSchema
>["body"];

