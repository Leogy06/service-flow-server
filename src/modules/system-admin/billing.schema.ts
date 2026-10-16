import { z } from "zod";
const id = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(5).max(1000);
const mutation = { reason, confirm: z.literal(true) };
const money = z.string().trim().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "Use a positive decimal amount with at most two decimal places").refine((value) => Number(value) > 0);
const currency = z.string().regex(/^[A-Z]{3}$/, "Use an uppercase three-letter currency code");
const planFields = { name: z.string().trim().min(2).max(100), description: z.string().trim().max(1000).nullable().optional(),
  price: money, billingInterval: z.enum(["MONTHLY", "YEARLY"]).default("YEARLY"), currency: currency.default("PHP"), maxActiveUsers: z.number().int().min(1).max(100000), isActive: z.boolean().default(true) };
const paging = { page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(), sortOrder: z.enum(["asc", "desc"]).default("desc") };
export const planListSchema = z.object({ query: z.object({ ...paging, status: z.enum(["ACTIVE", "RETIRED"]).optional(), billingInterval: z.enum(["MONTHLY", "YEARLY"]).optional(), sortBy: z.enum(["createdAt", "name", "price", "maxActiveUsers"]).default("createdAt") }).strict() });
export const subscriptionListSchema = z.object({ query: z.object({ ...paging, organizationId: id.optional(), planId: id.optional(),
  status: z.enum(["PENDING", "ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED"]).optional(), sortBy: z.enum(["createdAt", "expiresAt", "status"]).default("createdAt") }).strict() });
export const paymentListSchema = z.object({ query: z.object({ ...paging, organizationId: id.optional(), subscriptionId: id.optional(),
  status: z.enum(["PENDING", "UNDER_REVIEW", "PAID", "REJECTED", "REFUNDED"]).optional(), sortBy: z.enum(["createdAt", "paidAt", "verifiedAt", "amount", "status"]).default("createdAt") }).strict() });
export const billingDetailSchema = z.object({ params: z.object({ id }).strict() });
export const createPlanSchema = z.object({ body: z.object({ ...planFields, ...mutation }).strict() });
export const updatePlanSchema = z.object({ params: z.object({ id }), body: z.object({ name: planFields.name.optional(), description: planFields.description,
  price: money.optional(), billingInterval: planFields.billingInterval.removeDefault().optional(), currency: currency.optional(), maxActiveUsers: planFields.maxActiveUsers.optional(), isActive: z.boolean().optional(), ...mutation }).strict()
  .refine((input) => Object.keys(input).some((key) => !["reason", "confirm"].includes(key)), "Provide at least one plan field") });
export const assignSubscriptionSchema = z.object({ body: z.object({ organizationId: id, planId: id.optional(), ...mutation }).strict() });
export const changePlanSchema = z.object({ params: z.object({ id }), body: z.object({ planId: id, ...mutation }).strict() });
export const changeSubscriptionStatusSchema = z.object({ params: z.object({ id }), body: z.object({ status: z.enum(["PAST_DUE", "CANCELED"]), ...mutation }).strict() });
export const recordPaymentSchema = z.object({ body: z.object({ subscriptionId: id, amount: money, currency,
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "GCASH", "CARD", "OTHER"]), referenceNumber: z.string().trim().min(3).max(150),
  idempotencyKey: z.string().trim().min(8).max(100), paidAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value))
    .refine((value) => value.getTime() <= Date.now() + 60_000, "Payment date must not be in the future"), ...mutation }).strict() });
const evidence = z.string().trim().min(3).max(1000);
export const reviewPaymentSchema = z.object({ params: z.object({ id }), body: z.object({ decision: z.enum(["UNDER_REVIEW", "PAID", "REJECTED"]), evidence, ...mutation }).strict() });
export const refundPaymentSchema = z.object({ params: z.object({ id }), body: z.object({ evidence, idempotencyKey: z.string().trim().min(8).max(100), ...mutation }).strict() });
export type PlanListQuery = z.infer<typeof planListSchema>["query"];
export type SubscriptionListQuery = z.infer<typeof subscriptionListSchema>["query"];
export type PaymentListQuery = z.infer<typeof paymentListSchema>["query"];
export type CreatePlanInput = z.infer<typeof createPlanSchema>["body"];
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>["body"];
export type AssignSubscriptionInput = z.infer<typeof assignSubscriptionSchema>["body"];
export type ChangePlanInput = z.infer<typeof changePlanSchema>["body"];
export type ChangeStatusInput = z.infer<typeof changeSubscriptionStatusSchema>["body"];
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>["body"];
export type ReviewPaymentInput = z.infer<typeof reviewPaymentSchema>["body"];
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>["body"];
