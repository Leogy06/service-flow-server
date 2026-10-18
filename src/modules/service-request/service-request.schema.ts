import { z } from "zod";

export const statuses = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
const id = z.string().trim().min(1).max(64);
const params = z.object({ id });
const paging = {
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(200).default(""),
};
const requestBody = z.object({
  customerId: id,
  serviceTypeId: id,
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(5000).default(""),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});
export const createRequestInput = z.object({ body: requestBody });
export const updateRequestInput = z.object({ params, body: requestBody.partial().refine(
  (value) => Object.keys(value).length > 0, "At least one field is required",
) });
export const requestParamsInput = z.object({ params });
export const statusInput = z.object({ params, body: z.object({ status: z.enum(statuses) }) });
export const requestListInput = z.object({ query: z.object({
  ...paging,
  status: z.enum(statuses).optional(),
  priority: requestBody.shape.priority.removeDefault().optional(),
  serviceTypeId: id.optional(),
  sortBy: z.literal("createdAt").default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
}) });
export const customerOptionsInput = z.object({ query: z.object(paging) });
export const typeListInput = z.object({ query: z.object({
  ...paging, active: z.enum(["all", "active", "archived"]).default("active"),
}) });
const typeBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(191),
  description: z.string().trim().max(2000).default(""),
  basePrice: z.coerce.number().finite().min(0).max(99_999_999.99).refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001,
    "Price must have at most two decimal places",
  ),
});
export const createTypeInput = z.object({ body: typeBody });
export const updateTypeInput = z.object({ params, body: typeBody.partial().refine(
  (value) => Object.keys(value).length > 0, "At least one field is required",
) });
export type CreateRequest = z.infer<typeof requestBody>;
export type UpdateRequest = z.infer<typeof updateRequestInput>["body"];
export type RequestList = z.infer<typeof requestListInput>["query"];
export type TypeList = z.infer<typeof typeListInput>["query"];
export type CreateType = z.infer<typeof typeBody>;
export type UpdateType = z.infer<typeof updateTypeInput>["body"];
