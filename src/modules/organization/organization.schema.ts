import { z } from "zod";

export const organizationSchema = z.object({
  body: z.object({
    name: z
      .string("Minimum 2 characters and maximum 100 characters")
      .min(2, "Organization name is required")
      .max(100),
    slug: z
      .string("Minimum 2 characters and maximum 50 characters")
      .min(2, "Organization slug is required")
      .max(50),
  }),
});

export type OrganizationInput = z.infer<typeof organizationSchema>["body"];
