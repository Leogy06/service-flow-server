import { z } from "zod";
import { databaseEnvironmentSchema } from "./database";
import { redisUrlSchema } from "./redis-url";

export const envSchema = databaseEnvironmentSchema.safeExtend({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // Enable only behind the single private Caddy proxy; never publish the API port.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  CORS_ORIGIN: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.origin === value;
    } catch { return false; }
  }, "Must be an exact HTTP(S) origin without a trailing slash"),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  ACCESS_TOKEN_EXPIRY: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),

  //bcrypt
  SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  //redis
  REDIS_URL: redisUrlSchema,
  REFUND_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 60 * 1000),
  REFUND_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  SIGNUP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  SIGNUP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  FEEDBACK_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  FEEDBACK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  FEEDBACK_INVITATION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  BRANDING_UPLOAD_DIR: z.string().trim().min(1).default("storage/branding"),
  BRANDING_UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  BRANDING_UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  BRANDING_ASSET_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  BRANDING_ASSET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  PUBLIC_PAGE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),
  PUBLIC_PAGE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),

  //resend
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),

  //pino
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional(),
  LOG_MAX_FILES: z.coerce.number().int().positive().default(14),
  // Only used by the explicit operator CLI, which applies stricter validation.
  SYSTEM_ADMIN_EMAIL: z.string().optional(),
  SYSTEM_ADMIN_PASSWORD: z.string().optional(),
  SYSTEM_ADMIN_REASON: z.string().optional(),
  PLATFORM_TEST_DATABASE_NAME: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== "production") return;
  if (!value.REDIS_URL.startsWith("rediss://")) {
    ctx.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Production requires rediss:// (TLS)" });
  }
  if (!value.CORS_ORIGIN.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["CORS_ORIGIN"], message: "Production requires an HTTPS origin" });
  }
}).transform((value) => ({
  ...value,
  LOG_LEVEL: value.LOG_LEVEL ?? (value.NODE_ENV === "production" ? "info" : "debug"),
}));
