import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    email: z
      .string({ error: "Email is required" })
      .email({ error: "Invalid email address" })
      .toLowerCase()
      .trim(),
    password: z
      .string({ error: "Password is required" })
      .min(8, "Password must be at least 8 characters")
      .max(72, "Password must be at most 72 characters") // bcrypt's hard limit
      .regex(/[a-z]/, "Password must contain a lowercase letter")
      .regex(/[A-Z]/, "Password must contain an uppercase letter")
      .regex(/[0-9]/, "Password must contain a number"),
    firstName: z
      .string({ error: "First name is required" })
      .trim()
      .min(1, "First name is required")
      .max(100),
    lastName: z
      .string({ error: "Last name is required" })
      .trim()
      .min(1, "Last name is required")
      .max(100),
    middleName: z.string().trim().max(100).optional(),
    suffix: z.string().trim().max(20).optional(),
    phone: z
      .string({ error: "Invalid phone number" })
      .trim()
      .regex(/^\+?[0-9]{7,15}$/, { error: "Invalid phone number" })
      .optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.email({ error: "Invalid email address" }).toLowerCase().trim(),
    password: z
      .string({ error: "Password is required" })
      .min(1, "Password is required"),
  }),
});

// Infer TS types straight from the schemas — one source of truth
export type RegisterInput = z.infer<typeof registerSchema>["body"];
export type LoginInput = z.infer<typeof loginSchema>["body"];
