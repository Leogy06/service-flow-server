import { z } from "zod";

export const brandingReadSchema = z.object({ query: z.object({}).strict() });
export const brandingUpdateSchema = z.object({
  query: z.object({}).strict(),
  body: z.object({
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color").transform((value) => value.toLowerCase()).nullable().optional(),
    displayName: z.string().trim().min(1).max(100).refine((value) => [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "Display name contains invalid characters").nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "Choose a setting to update"),
});
export type BrandingUpdateInput = z.infer<typeof brandingUpdateSchema>["body"];

export const brandingAssetSchema = z.object({
  params: z.object({ filename: z.string().regex(/^[a-f0-9]{64}\.(png|jpg|webp)$/) }).strict(),
  query: z.object({}).strict(),
});
