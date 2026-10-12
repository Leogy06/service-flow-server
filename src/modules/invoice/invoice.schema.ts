import { z } from "zod";
import { listQuery, resourceId, resourceParams } from "@/modules/job/job.schema.js";

// Strings preserve exact decimal input across JSON and JavaScript clients.
export const decimalInput = z.string().trim().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/, "Enter a non-negative amount with at most two decimal places");
export const positiveDecimal = decimalInput.refine((value) => Number(value) > 0, "Amount must be greater than zero");
export const lineItem = z.object({
  description: z.string().trim().min(1).max(191),
  quantity: positiveDecimal,
  unitPrice: decimalInput,
});
const fields = z.object({
  items: z.array(lineItem).min(1, "At least one invoice item is required").max(100),
  dueAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).nullable().optional(),
  notes: z.string().trim().max(191).default(""),
});
export const createInvoiceInput = z.object({ body: fields.extend({ jobId: resourceId }) });
export const updateInvoiceInput = resourceParams.extend({ body: fields });
export const invoiceListInput = z.object({ query: listQuery.extend({
  status: z.enum(["UNPAID", "PARTIALLY_PAID", "PAID", "VOID"]).optional(),
  jobId: resourceId.optional(),
  serviceRequestId: resourceId.optional(),
}) });
export const voidInvoiceInput = resourceParams.extend({ body: z.object({ reason: z.string().trim().min(1, "Void reason is required").max(191) }) });
export type CreateInvoice = z.infer<typeof createInvoiceInput>["body"];
export type UpdateInvoice = z.infer<typeof updateInvoiceInput>["body"];
export type InvoiceList = z.infer<typeof invoiceListInput>["query"];
