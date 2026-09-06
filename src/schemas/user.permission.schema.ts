import z from "zod";

export const updateUserPermissionSchema = z.object({
  body: z.object({
    permissionIds: z
      .array(z.cuid2())
      .default([])
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate permission IDs are not allowed",
      ),
  }),
});
