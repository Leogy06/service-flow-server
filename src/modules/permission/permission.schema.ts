import z from "zod";

export const createPermissionSchema = z.object({
  body: z.object({
    reason: z.string().trim().min(3).max(1000),
    confirm: z.literal(true),
    name: z
      .string("Minimum 2 characters and maximum 100 characters")
      .min(2, "Permission name is required")
      .max(50),
    description: z
      .string("Minimum 2 characters and maximum 50 characters")
      .min(2, "Permission description is required")
      .max(100),
  }).strict(),
});

export type CreatePermissionSchema = z.infer<
  typeof createPermissionSchema
>["body"];

export type CreatePermissionInput = z.infer<typeof createPermissionSchema>;
