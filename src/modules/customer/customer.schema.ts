import { z } from "zod";
import { paginationSchema } from "@/schemas/pagination.schema.js";
import emptyToUndefined from "@/utils/emptyToUndefined.js";

const customerBodySchema = z.object({
  customerType: z.enum(["INDIVIDUAL", "ORGANIZATION"]),
  organizationName: z.string().trim().max(100).optional(),
  firstName: z
    .string()
    .trim()
    .max(100, "First name must not exceed 100 characters")
    .optional(),
  lastName: z
    .string()
    .trim()
    .max(100, "Last name must not exceed 100 characters")
    .optional(),
  middleName: z.string().trim().max(100).optional(),
  suffix: z.string().trim().max(20).optional(),
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

const hasValue = (v?: string | null) => !!v && v.trim().length > 0;

export const createCustomerSchema = z.object({
  body: customerBodySchema.superRefine((data, ctx) => {
    if (data.customerType === "INDIVIDUAL") {
      if (!hasValue(data.firstName)) {
        ctx.addIssue({
          code: "custom",
          message: "First name is required",
          path: ["firstName"],
        });
      }
      if (!hasValue(data.lastName)) {
        ctx.addIssue({
          code: "custom",
          message: "Last name is required",
          path: ["lastName"],
        });
      }
      if (hasValue(data.organizationName)) {
        ctx.addIssue({
          code: "custom",
          message: "Organization name not allowed for individual",
          path: ["organizationName"],
        });
      }
    } else if (data.customerType === "ORGANIZATION") {
      if (!hasValue(data.organizationName)) {
        ctx.addIssue({
          code: "custom",
          message: "Organization is required",
          path: ["organizationName"],
        });
      }
      if (hasValue(data.firstName)) {
        ctx.addIssue({
          code: "custom",
          message: "First name not allowed for organization",
          path: ["firstName"],
        });
      }
      if (hasValue(data.lastName)) {
        ctx.addIssue({
          code: "custom",
          message: "Last name not allowed for organization",
          path: ["lastName"],
        });
      }
    } else {
      ctx.addIssue({
        code: "custom",
        message: "Customer type is required",
        path: ["customerType"],
      });
    }
  }),
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
    z
      .enum(["firstName", "lastName", "email", "createdAt"])
      .default("createdAt"),
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
