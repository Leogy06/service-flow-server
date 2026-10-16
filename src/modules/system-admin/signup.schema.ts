import { z } from "zod";
import { registerSchema } from "@/modules/auth/auth.schema.js";

export const signupListSchema = z.object({ query: z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
}).strict() });
export const signupCountSchema = z.object({ query: z.object({}).strict() });
export const signupReviewSchema = z.object({
  params: z.object({ id: z.string().trim().min(1).max(191) }).strict(),
  body: z.discriminatedUnion("decision", [
    z.object({ decision: z.literal("APPROVED"), reason: z.string().trim().min(5).max(1000), confirm: z.literal(true),
      slug: registerSchema.shape.body.shape.slug, planId: z.string().trim().min(1).max(191), startTrial: z.boolean(),
    }).strict(),
    z.object({ decision: z.literal("REJECTED"), reason: z.string().trim().min(5).max(1000), confirm: z.literal(true) }).strict(),
  ]),
});
export type SignupListQuery = z.infer<typeof signupListSchema>["query"];
export type SignupReviewInput = z.infer<typeof signupReviewSchema>["body"];
