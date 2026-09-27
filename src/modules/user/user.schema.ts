import z from "zod";

export const baseUserSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  middleName: z.string().optional(),
  suffix: z.string().optional(),
  phone: z
    .string()
    .trim()
    .regex(
      /^(?:\+63|63|0)9\d{9}$/,
      "Please enter a valid Philippine mobile number",
    )
    .optional(),
  email: z.email("Invalid email").min(1, "Email is required"),
  roleId: z.string().min(1, "Role ID is required"),
  organizationId: z.string().optional(),
});
export const createUserSchema = z.object({
  body: baseUserSchema.omit({
    organizationId: true,
  }),
});
export const createUserInviteSchema = z.object({
  body: baseUserSchema.extend({
    password: z.string().optional(),
  }),
});
export const userUpdateSchema = z.object({
  body: baseUserSchema.omit({ organizationId: true, roleId: true }).extend({
    id: z.string().min(1, "User ID is required"),
  }),
});
export const setPasswordSchema = z.object({
  body: z.object({
    password: z.string().min(1, "Password is required"),
    confirmPassword: z.string().min(1, "Confirm password is required"),
  }),
});
export const setPasswordParams = z.object({
  params: z.object({
    email: z.email("Invalid email").min(1, "Email is required"),
    token: z.string().min(1, "Token is required"),
  }),
});

export const resetTokenExpirationDateInvitationSchema = z.object({
  body: z.object({
    email: z.email("Invalid email").min(1, "Email is required"),
    token: z.string().min(1, "Token is required"),
  }),
});

export type CreateUserSchema = z.infer<typeof createUserSchema>["body"];
export type CreateUserInviteSchema = z.infer<
  typeof createUserInviteSchema
>["body"];
export type ResetTokenExpirationDateInvitationSchema = z.infer<
  typeof resetTokenExpirationDateInvitationSchema
>["body"];
export type SetPasswordParams = z.infer<typeof setPasswordParams>["params"];
export type SetPasswordSchema = z.infer<typeof setPasswordSchema>["body"];
export type UpdateUserSchema = z.infer<typeof userUpdateSchema>["body"];
