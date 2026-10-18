import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).refine((value) => [...value].every((character) => (character >= " " && character !== "\u007f") || ["\n", "\r", "\t"].includes(character)), "Remove unsupported control characters");
const publicUrl = (message: string, allowed?: (url: URL) => boolean) => z.string().trim().max(2048).refine((value) => {
  if (!value) return true;
  if (!/^https:\/\//i.test(value) || /[\s\\]/.test(value) || [...value].some((character) => character < " " || character === "\u007f")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && (!allowed || allowed(url));
  } catch { return false; }
}, message).default("");
const profileHost = (url: URL, domains: string[]) => domains.some((domain) => url.hostname === domain || url.hostname === `www.${domain}`);
const googleMapsLink = (url: URL) =>
  (["google.com", "www.google.com", "goo.gl", "www.goo.gl"].includes(url.hostname) && /^\/maps(?:\/|$)/.test(url.pathname)) ||
  ["maps.google.com", "maps.app.goo.gl"].includes(url.hostname);

export const pageContentSchema = z.object({
  headline: text(160),
  about: text(4000),
  services: z.array(z.object({ name: text(100).min(1, "Enter a service name"), description: text(600) }).strict()).max(20),
  address: text(600),
  serviceArea: text(300),
  hours: text(600),
  phone: z.union([z.literal(""), z.string().trim().max(40).regex(/^\+?[0-9 ()\-.]+$/, "Enter a valid public phone number").refine((value) => { const digits = value.replace(/\D/g, ""); return digits.length >= 7 && digits.length <= 15; }, "Use a phone number with 7 to 15 digits")]),
  email: z.union([z.literal(""), z.email().max(254)]),
  coverImageUrl: publicUrl("Enter a public HTTPS photo URL without a username, password, or custom port"),
  facebookUrl: publicUrl("Enter an HTTPS Facebook profile or page URL", (url) => profileHost(url, ["facebook.com", "fb.com"])),
  instagramUrl: publicUrl("Enter an HTTPS Instagram profile URL", (url) => profileHost(url, ["instagram.com"])),
  linkedinUrl: publicUrl("Enter an HTTPS LinkedIn profile or company URL", (url) => profileHost(url, ["linkedin.com"])),
  googleMapsUrl: publicUrl("Enter an HTTPS Google Maps place or share URL", googleMapsLink),
}).strict();

export const emptyPageContent = () => pageContentSchema.parse({ headline: "", about: "", services: [], address: "", serviceArea: "", hours: "", phone: "", email: "" });
export const pageReadSchema = z.object({ query: z.object({}).strict() });
export const publicPageSchema = z.object({
  params: z.object({ slug: z.string().min(2).max(50).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict(),
  query: z.object({}).strict(),
});
export type PublicPageParams = z.infer<typeof publicPageSchema>["params"];
export const pageUpdateSchema = z.object({
  query: z.object({}).strict(),
  body: z.object({
    content: pageContentSchema,
    publication: z.enum(["keep", "publish", "unpublish"]),
    version: z.iso.datetime().nullable(),
  }).strict(),
});
export type PageUpdateInput = z.input<typeof pageUpdateSchema>["body"];

export function publicationIssues(content: z.infer<typeof pageContentSchema>): string[] {
  return [
    ...(!content.headline ? ["Add a headline"] : []),
    ...(!content.about ? ["Tell visitors about your business"] : []),
    ...(!content.services.length ? ["Add at least one service"] : []),
    ...(!content.address ? ["Add your business location"] : []),
    ...(!content.phone && !content.email ? ["Add a public phone number or email"] : []),
  ];
}
