import { z } from "zod";

export const redisUrlSchema = z.string().trim().pipe(
  z.url({ error: "REDIS_URL must be a valid Redis connection URL" }),
).superRefine((value, ctx) => {
  // Zod may run refinements after a URL-format issue; keep safeParse non-throwing.
  if (!URL.canParse(value)) return;
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname) {
    ctx.addIssue({ code: "custom", message: "REDIS_URL must use redis:// or rediss:// with a hostname (not an HTTPS REST URL)" });
  }
  const isUpstash = ["upstash.io", "upstash.com"].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  if (isUpstash && (url.protocol !== "rediss:" || !url.password)) {
    ctx.addIssue({ code: "custom", message: "Upstash REDIS_URL requires rediss:// and the database password; copy the TCP connection URL" });
  }
});
