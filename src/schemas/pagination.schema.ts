import z from "zod";

export const paginationSchema = z.object({
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10),
    search: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  }),
});

export const customerListInput = z.object({
  query: z.object({
    sortBy: z
      .enum(["firstName", "lastName", "email", "createdAt"])
      .default("createdAt"),
  }),
});

export type CustomerListInput = z.infer<typeof customerListInput>["query"];
export type PaginationQuery = z.infer<typeof paginationSchema>["query"];
