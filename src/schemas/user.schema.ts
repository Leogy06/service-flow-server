import z from "zod";

export const userSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.email("Invalid email").min(1, "Email is required"),
    password: z.string().min(1, "Password is required"),
    organizationId: z.string().min(1, "Organization ID is required"),
  }),
});

export type UserSchema = z.infer<typeof userSchema>["body"];
