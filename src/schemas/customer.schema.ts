import { z } from "zod";
import { paginationSchema } from "./pagination.schema.js";
import emptyToUndefined from "@/utils/emptyToUndefined.js";

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
      .regex(
        /^(?:\+63|63|0)9\d{9}$/,
        "Please enter a valid Philippine mobile number",
      ),
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

//separate schema because it is exclusive to specific model
export const customerListQuerySchema = paginationSchema.extend({
  sortBy: emptyToUndefined(
    z
      .enum(["firstName", "lastName", "email", "createdAt"])
      .default("createdAt"),
  ),
});

//query accessor in the schema vald   iation
export const customerListInput = z.object({
  query: customerListQuerySchema,
});

export const updateCustomerSchema = z.object({
  body: createCustomerSchema.shape.body
    .partial()
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field must be provided",
    }),
});

export const updateCustomerParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Customer id is required"),
  }),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>["body"];
export type CustomerListInput = z.infer<typeof customerListInput>;

//update custoemr chema
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>["body"];

//update customer params schema
export type UpdateCustomerParamsInput = z.infer<
  typeof updateCustomerParamsSchema
>["params"];
