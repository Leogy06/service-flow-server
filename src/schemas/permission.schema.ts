import z from "zod";

export const createPermissionSchema = z.object({
  body: z.object({
    roleId: z.string().min(1, "Role ID is required"),
    permissionId: z.string().min(1, "Permission ID is required"),
  }),
});

export type CreatePermissionSchema = z.infer<
  typeof createPermissionSchema
>["body"];

