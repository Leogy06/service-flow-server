import { z } from "zod";
import { paginationSchema } from "@/schemas/pagination.schema.js";
import emptyToUndefined from "@/utils/emptyToUndefined.js";

const customerBodySchema = z.object({
  name: z.string().trim().max(100).min(2, "Name is required"),
  email: z
    .email("Invalid email address")
    .min(1, "Email is required")
    .trim()
    .toLowerCase()
    .max(255),
  phoneNumber: z
    .string()
    .trim()
    .regex(
      /^(?:\+63|63|0)9\d{9}$/,
      "Please enter a valid Philippine mobile number",
    ),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const createCustomerSchema = z.object({
  body: customerBodySchema,
});

export const updateCustomerSchema = z.object({
  body: customerBodySchema
    .partial()
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field must be provided",
    }),
});

//separate schema because it is exclusive to specific model
export const customerListQuerySchema = paginationSchema.extend({
  sortBy: emptyToUndefined(
    z.enum(["name", "email", "createdAt"]).default("createdAt"),
  ),
});

//query accessor in the schema vald   iation
export const customerListInput = z.object({
  query: customerListQuerySchema,
});

export const updateCustomerParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Customer id is required"),
  }),
});

export type CreateCustomerSchema = z.infer<typeof createCustomerSchema>["body"];
export type CustomerListInput = z.infer<typeof customerListInput>;

//update custoemr chema
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>["body"];

//update customer params schema
export type UpdateCustomerParamsInput = z.infer<
  typeof updateCustomerParamsSchema
>["params"];
