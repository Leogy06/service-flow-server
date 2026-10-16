import { z } from "zod";
import { paginationSchema } from "@/schemas/pagination.schema.js";
import emptyToUndefined from "@/utils/emptyToUndefined.js";

const customerBodySchema = z.object({
  name: z.string().trim().max(100).min(2, "Name is required"),
  email: z.string().trim().toLowerCase().pipe(z.email("Invalid email address").max(255)),
  phoneNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(
      /^(?:\+63|63|0)9\d{9}$/,
      "Please enter a valid Philippine mobile number",
    )),
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

export const customerListQuerySchema = paginationSchema.extend({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(200).optional(),
  deleted: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  filter: emptyToUndefined(z.enum(["all", "missing_address", "with_notes"]).default("all")),
  sortOrder: emptyToUndefined(z.enum(["asc", "desc"]).default("desc")),
  sortBy: emptyToUndefined(
    z.enum(["name", "email", "createdAt"]).default("createdAt"),
  ),
});

export const customerListInput = z.object({
  query: customerListQuerySchema,
});

export const customerParamsSchema = z.object({
  params: z.object({ id: z.string().trim().min(1, "Customer id is required").max(64) }),
});

export const updateCustomerInput = updateCustomerSchema.extend({
  params: customerParamsSchema.shape.params,
});

export type CreateCustomerSchema = z.infer<typeof createCustomerSchema>["body"];
export type CustomerListInput = z.infer<typeof customerListInput>;

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>["body"];

export type CustomerParams = z.infer<typeof customerParamsSchema>["params"];
