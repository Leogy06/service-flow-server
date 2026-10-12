import { z } from "zod";

export const listAuditLogsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    search: z.string().trim().max(120).default(""),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    action: z.string().trim().min(1).max(191).optional(),
    entity: z.string().trim().min(1).max(191).optional(),
  }).strict(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsSchema>["query"];
