import z from "zod";

export const createRoleSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Role name is required"),
    organizationId: z.string().min(1, "Organization ID is required"),
  }),
});

export type CreateRoleSchema = z.infer<typeof createRoleSchema>["body"];
