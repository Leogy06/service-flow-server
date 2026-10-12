import { z } from "zod";
import { resourceParams } from "@/modules/job/job.schema.js";
import { positiveDecimal } from "@/modules/invoice/invoice.schema.js";

export const recordPaymentInput = resourceParams.extend({ body: z.object({
  idempotencyKey: z.uuid(),
  amount: positiveDecimal,
  method: z.enum(["CASH", "BANK_TRANSFER", "GCASH", "CARD", "OTHER"]),
  referenceNumber: z.string().trim().max(191).default(""),
  notes: z.string().trim().max(191).default(""),
}) });
export type RecordPayment = z.infer<typeof recordPaymentInput>["body"];
