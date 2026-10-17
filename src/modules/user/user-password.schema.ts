import { z } from "zod";
import { registerSchema } from "@/modules/auth/auth.schema";
import { resourceId } from "@/modules/role/role.schema";

export const resetStaffPasswordSchema = z.object({
  params: z.object({ id: resourceId }).strict(),
  body: z
    .object({
      currentPassword: z
        .string()
        .min(1, "Your current password is required")
        .max(128),
      newPassword: registerSchema.shape.body.shape.password.refine(
        (value) => Buffer.byteLength(value, "utf8") <= 72,
        "Password must be at most 72 bytes",
      ),
      confirmPassword: z.string().min(1, "Confirm the new password"),
      reason: z
        .string()
        .trim()
        .min(5, "Enter a reason of at least 5 characters")
        .max(1000),
      confirm: z.literal(true),
    })
    .strict()
    .refine((body) => body.newPassword === body.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    })
    .refine((body) => body.newPassword !== body.currentPassword, {
      message: "Choose a staff password different from your own password",
      path: ["newPassword"],
    })
    .refine(
      (body) =>
        !body.reason.includes(body.newPassword) &&
        !body.reason.includes(body.currentPassword),
      {
        message: "Do not include passwords in the reset reason",
        path: ["reason"],
      },
    ),
});

export type ResetStaffPasswordInput = z.infer<
  typeof resetStaffPasswordSchema
>["body"];
