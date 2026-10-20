import { z } from "zod";

export const resourceId = z.string().trim().min(1).max(64);
export const resourceParams = z.object({ params: z.object({ id: resourceId }) });
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(200).default(""),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
const date = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const futureDate = (label: string) => date.refine(
  (value) => value.getTime() > Date.now(), `${label} must be in the future`,
);
const jobFields = z.object({
  assignedStaffId: resourceId,
  description: z.string().trim().max(191),
  location: z.string().trim().max(191),
  internalNotes: z.string().trim().max(191),
  scheduledStart: futureDate("Scheduled start").nullable().optional(),
  scheduledEnd: futureDate("Scheduled end").nullable().optional(),
  overrideStaffConflict: z.boolean().optional(),
});
export const createJobInput = z.object({ body: jobFields.extend({
  serviceRequestId: resourceId,
  description: jobFields.shape.description.default(""),
  location: jobFields.shape.location.default(""),
  internalNotes: jobFields.shape.internalNotes.default(""),
}).refine(
  (value) => !value.scheduledEnd || !!value.scheduledStart && value.scheduledEnd >= value.scheduledStart,
  { message: "Scheduled end must follow scheduled start", path: ["scheduledEnd"] },
) });
export const updateJobInput = resourceParams.extend({ body: jobFields.partial().refine(
  (value) => Object.keys(value).some((key) => key !== "overrideStaffConflict"), "At least one field is required",
) });
export const jobListInput = z.object({ query: listQuery.extend({
  status: z.enum(["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  serviceRequestId: resourceId.optional(),
  customerId: resourceId.optional(),
  serviceTypeId: resourceId.optional(),
  assignedStaffId: resourceId.optional(),
  mine: z.enum(["true", "false"]).default("false"),
  billable: z.enum(["true", "false"]).default("false"),
}) });
export const jobFiltersInput = z.object({ query: jobListInput.shape.query.pick({
  serviceRequestId: true, mine: true, billable: true,
}).strict() });
export const staffListInput = z.object({ query: listQuery });
export const jobStatusInput = resourceParams.extend({ body: z.object({
  status: z.enum(["IN_PROGRESS", "COMPLETED"]),
  note: z.string().trim().max(191).default(""),
  overrideStaffConflict: z.boolean().optional(),
}) });
export const cancelJobInput = resourceParams.extend({ body: z.object({ note: z.string().trim().min(1, "Cancellation reason is required").max(191) }) });
export type CreateJob = z.infer<typeof createJobInput>["body"];
export type UpdateJob = z.infer<typeof updateJobInput>["body"];
export type JobList = z.infer<typeof jobListInput>["query"];
export type JobFilters = z.infer<typeof jobFiltersInput>["query"];
