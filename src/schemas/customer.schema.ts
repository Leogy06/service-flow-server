import { z } from "zod";

export const createCustomerSchema = z.object({
  body: z.object({
    firstName: z
      .string()
      .trim()
      .min(1, "First name is required")
      .max(100, "First name must not exceed 100 characters"),

    lastName: z
      .string()
      .trim()
      .min(1, "Last name is required")
      .max(100, "Last name must not exceed 100 characters"),

    middleName: z
      .string()
      .trim()
      .max(100, "Middle name must not exceed 100 characters")
      .optional(),

    suffix: z
      .string()
      .trim()
      .max(20, "Suffix must not exceed 20 characters")
      .optional(),

    email: z
      .email("Invalid email address")
      .min(1, "Email is required")
      .trim()
      .toLowerCase()
      .max(255, "Email must not exceed 255 characters"),

    phoneNumber: z
      .string()
      .trim()
      .min(7, "Invalid phone number")
      .max(20, "Phone number must not exceed 20 characters"),

    address: z
      .string()
      .trim()
      .max(500, "Address must not exceed 500 characters")
      .optional(),

    notes: z
      .string()
      .trim()
      .max(2000, "Notes must not exceed 2000 characters")
      .optional(),
  }),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>["body"];
