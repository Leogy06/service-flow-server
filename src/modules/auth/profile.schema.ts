import { z } from "zod";
import { registerSchema } from "./auth.schema.js";
import { baseUserSchema } from "@/modules/user/user.schema.js";

export const updateProfileSchema = z.object({
  body: z.object({
    firstName: registerSchema.shape.body.shape.firstName,
    lastName: registerSchema.shape.body.shape.lastName,
    middleName: z.string().trim().max(100).nullable(),
    suffix: z.string().trim().max(20).nullable(),
    phone: z.union([baseUserSchema.shape.phone.unwrap(), z.literal(""), z.null()])
      .transform((value) => value === "" ? null : value),
  }).strict(),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required").max(128),
    newPassword: registerSchema.shape.body.shape.password.refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password must be at most 72 bytes",
    ),
  }).strict(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>["body"];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>["body"];
