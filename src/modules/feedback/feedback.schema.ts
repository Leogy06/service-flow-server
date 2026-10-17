import { z } from "zod";

export const CONSENT_VERSION = "2026-10-17";
const id = z.string().trim().min(1).max(191);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid feedback link");
const fields = {
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1, "Please share your feedback").max(2000),
  displayName: z.string().trim().max(100).default(""),
  allowTestimonial: z.boolean().default(false),
};
const consent = (value: { allowTestimonial: boolean; displayName: string }) =>
  !value.allowTestimonial || value.displayName.length > 0;
const consentError = { message: "Enter a display name to allow a testimonial", path: ["displayName"] };
export const productInput = z.object({ body: z.object({ ...fields, submissionKey: z.uuid() }).strict().refine(consent, consentError) });
export const publicSubmitInput = z.object({ body: z.object({ ...fields, token }).strict().refine(consent, consentError) });
export const publicTokenInput = z.object({ body: z.object({ token }).strict() });
export const invitationInput = z.object({ body: z.object({ serviceRequestId: id }).strict() });
export const feedbackIdInput = z.object({ params: z.object({ id }) });
export const reviewInput = z.object({
  params: z.object({ id }),
  body: z.object({
    status: z.enum(["NEW", "IN_REVIEW", "RESOLVED"]).optional(),
    testimonialApproved: z.boolean().optional(),
  }).strict().refine((value) => value.status !== undefined || value.testimonialApproved !== undefined, "Choose a review action"),
});
export const listInput = z.object({ query: z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(["NEW", "IN_REVIEW", "RESOLVED"]).optional(),
  testimonials: z.enum(["ready"]).optional(),
}) });
export type ProductInput = z.infer<typeof productInput>["body"];
export type PublicSubmitInput = z.infer<typeof publicSubmitInput>["body"];
export type FeedbackList = z.infer<typeof listInput>["query"];
export type ReviewInput = z.infer<typeof reviewInput>["body"];
