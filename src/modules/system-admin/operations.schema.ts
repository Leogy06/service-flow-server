import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const mutation = { confirm: z.literal(true), reason: z.string().trim().min(3).max(1000) };
export const dateWindowSchema = z.object({ query: z.object({ from: date.optional(), to: date.optional() }).strict() });
export const settingsSchema = z.object({ body: z.object({
  ...mutation,
  reminderIntervals: z.array(z.number().int().min(1).max(365)).min(1).max(10).refine((v) => new Set(v).size === v.length),
  gracePeriodDays: z.number().int().min(0).max(30),
  paymentInstructions: z.string().trim().max(5000),
  supportEmail: z.email().max(254).nullable(), supportPhone: z.string().trim().max(50).nullable(),
  maintenanceMessage: z.string().trim().max(2000), defaultPlanId: z.string().min(1).max(100).nullable(),
}).strict() });
export const alertListSchema = z.object({ query: z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.enum(["true", "false"]).optional(),
}).strict() });
export const alertProcessSchema = z.object({ body: z.object({ ...mutation, cursor: z.string().max(100).optional() }).strict() });
export const alertReadSchema = z.object({ params: z.object({ id: z.string().min(1).max(100) }), body: z.object(mutation).strict() });
export type SettingsInput = z.infer<typeof settingsSchema>["body"];
export type AlertListQuery = z.infer<typeof alertListSchema>["query"];
