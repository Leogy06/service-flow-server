import z from "zod";

const roleBaseSchema = z.object({
  name: z.string().min(1, "Role name is required"),
  organizationId: z.string().min(1, "Organization ID is required"),
});

export const createRoleSchema = z.object({
  body: roleBaseSchema.omit({
    organizationId: true,
  }),
});

export type CreateRoleSchema = z.infer<typeof createRoleSchema>["body"];
