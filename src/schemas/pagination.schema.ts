import emptyToUndefined from "@/utils/emptyToUndefined.js";
import z from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortOrder: emptyToUndefined(z.enum(["asc", "desc"]).default("asc")),
});

export type PaginationQuery = z.infer<typeof paginationSchema>;
