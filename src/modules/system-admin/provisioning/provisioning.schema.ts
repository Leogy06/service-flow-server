import { z } from "zod";
import { registerSchema } from "@/modules/auth/auth.schema";
import { industryIds } from "./templates";

const reason = z.string().trim().min(5).max(1000);
const owner = registerSchema.shape.body.pick({ firstName: true, lastName: true, email: true }).strict();
const common = {
  idempotencyKey: z.uuid(),
  templateId: z.enum(industryIds),
  organization: z.object({ name: z.string().trim().min(2).max(100), slug: registerSchema.shape.body.shape.slug }).strict(),
  owner,
  includeDemoData: z.boolean().default(false),
  generateWebsite: z.boolean().default(true),
  reason,
  confirm: z.literal(true),
};
export const provisioningBody = z.discriminatedUnion("mode", [
  z.object({ ...common, mode: z.literal("REAL"), planId: z.string().trim().min(1).max(191), startTrial: z.boolean().default(true) }).strict()
    .refine((value) => !value.includeDemoData, { message: "Sample data is only available for demo organizations", path: ["includeDemoData"] }),
  z.object({ ...common, mode: z.literal("DEMO"), planId: z.undefined().optional(), startTrial: z.undefined().optional() }).strict(),
]);
const params = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/, "Invalid provisioning identifier") }).strict();
export const provisioningCreateSchema = z.object({ body: provisioningBody });
export const provisioningDetailSchema = z.object({ params, query: z.object({}).strict() });
export const provisioningActionSchema = z.object({ params, body: z.object({ reason, confirm: z.literal(true) }).strict() });
export const provisioningTemplatesSchema = z.object({ query: z.object({}).strict() });
export const provisioningTemplateSchema = z.object({ params: z.object({ templateId: z.enum(industryIds) }).strict(), query: z.object({}).strict() });
export type ProvisioningInput = z.input<typeof provisioningBody>;
export type NormalizedProvisioningInput = z.infer<typeof provisioningBody>;
export type ProvisioningActionInput = z.infer<typeof provisioningActionSchema>["body"];
