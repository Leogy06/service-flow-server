import { z } from "zod";

export const accessLogQuery = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).transform((value) => Math.min(value, 200)).default(50),
    ip: z.union([z.ipv4(), z.ipv6(), z.literal("")]).optional(),
  }),
});
export type AccessLogQuery = z.infer<typeof accessLogQuery>["query"];
