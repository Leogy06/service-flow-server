import z from "zod";

export const systemAdminSchema = z.object({
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
    .min(1, "Phone number is required"),
  email: z.email("Invalid email").min(1, "Email is required"),
  roleId: z.string().min(1, "Role ID is required"),
});

export const systemAdminCreateSchema = systemAdminSchema;
export type UserCreateSystemAdminInput = z.infer<
  typeof systemAdminCreateSchema
>;
