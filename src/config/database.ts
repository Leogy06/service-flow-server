import type { PoolConfig } from "mariadb";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const databaseUrlSchema = z.string().url({ error: "Must be a valid mysql:// connection URL" })
  .superRefine((value, ctx) => {
    if (!URL.canParse(value)) return;
    const url = new URL(value);
    if (url.protocol !== "mysql:" || !url.hostname || !url.username || url.pathname.length < 2 || url.hash) {
      ctx.addIssue({ code: "custom", message: "Must use mysql:// with a host, username and database; URL-encode special characters" });
    }
    try {
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
      decodeURIComponent(url.pathname);
    } catch {
      ctx.addIssue({ code: "custom", message: "Contains invalid URL encoding" });
    }
    const limit = url.searchParams.get("connection_limit");
    if (limit !== null && (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)) {
      ctx.addIssue({ code: "custom", message: "connection_limit must be an integer between 1 and 100" });
    }
    const ssl = url.searchParams.get("sslaccept");
    if (ssl !== null && ssl !== "strict") {
      ctx.addIssue({ code: "custom", message: "sslaccept must be strict; certificate verification cannot be disabled" });
    }
    // Keep CLI and adapter behavior aligned instead of silently ignoring options.
    for (const key of url.searchParams.keys()) {
      if (!["connection_limit", "sslaccept", "sslcert", "socket"].includes(key)) {
        ctx.addIssue({ code: "custom", message: "Unsupported database URL option; supported: connection_limit, sslaccept, sslcert, socket" });
        break;
      }
    }
  });

export const databaseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: databaseUrlSchema,
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== "production" || !URL.canParse(value.DATABASE_URL)) return;
  const url = new URL(value.DATABASE_URL);
  if (url.searchParams.get("sslaccept") !== "strict") {
    ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Production requires sslaccept=strict for verified TLS in the API and migrations" });
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || /^127\./.test(hostname) || ["[::1]", "0.0.0.0", "[::]"].includes(hostname) || url.searchParams.has("socket")) {
    ctx.addIssue({ code: "custom", path: ["DATABASE_URL"], message: "Production requires a remote MySQL host, not a loopback address or local socket" });
  }
});

// Prisma 7 uses the MariaDB driver's options, not Prisma URL pool/SSL options.
export function databaseOptions(env: { DATABASE_URL: string; NODE_ENV: string }): PoolConfig {
  const url = new URL(env.DATABASE_URL);
  const cert = url.searchParams.get("sslcert");
  const tls = env.NODE_ENV === "production" || url.searchParams.has("sslaccept") || Boolean(cert);
  let ca: Buffer | undefined;
  if (cert) {
    try {
      // Match Prisma CLI's certificate paths relative to the schema directory.
      ca = readFileSync(resolve(fileURLToPath(new URL("../../prisma/", import.meta.url)), cert));
    } catch {
      throw new Error("DATABASE_URL sslcert file could not be read (paths are relative to backend/prisma)");
    }
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    connectionLimit: Number(url.searchParams.get("connection_limit") ?? 5),
    allowPublicKeyRetrieval: env.NODE_ENV !== "production",
    ...(url.searchParams.has("socket") ? { socketPath: url.searchParams.get("socket")! } : {}),
    ...(tls ? { ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) } } : {}),
  };
}
