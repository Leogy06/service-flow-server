import { z } from "zod";
import { databaseEnvironmentSchema } from "./database";
import { redisUrlSchema } from "./redis-url";
import { rateLimitEnvironmentSchema } from "./rate-limit";

export const envSchema = databaseEnvironmentSchema.safeExtend({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CRON_SECRET: z.string().min(16).optional(),
  INTERNAL_API_SECRET: z.string().min(16).optional(),
  // Match the verified proxy path; every reachable path must have the same hop count.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  TRUST_PROXY_DIAGNOSTICS: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
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
  TWO_FACTOR_CODE_LENGTH: z.coerce.number().int().min(4).max(8).default(4),
  TWO_FACTOR_CODE_TTL_SECONDS: z.coerce.number().int().min(60).max(600).default(600),
  TWO_FACTOR_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(5),
  TWO_FACTOR_RESEND_SECONDS: z.coerce.number().int().min(60).default(60),
  TWO_FACTOR_SEND_MAX_PER_HOUR: z.coerce.number().int().positive().default(5),
  TWO_FACTOR_SECRET: z.string().min(32).optional(),
  TRUSTED_DEVICE_TENANT_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  TRUSTED_DEVICE_ADMIN_DAYS: z.coerce.number().int().min(1).max(30).default(7),

  //bcrypt
  SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  //redis
  // Native development works without a remote provider; production still requires TLS below.
  REDIS_URL: redisUrlSchema.default("redis://localhost:6379"),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  REDIS_MAX_RETRIES_PER_REQUEST: z.coerce.number().int().min(0).max(3).default(1),
  ...rateLimitEnvironmentSchema.shape,
  FEEDBACK_INVITATION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  BRANDING_UPLOAD_DIR: z.string().trim().min(1).default("storage/branding"),

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
  if (value.JWT_ACCESS_SECRET.trim().length < 32) {
    ctx.addIssue({ code: "custom", path: ["JWT_ACCESS_SECRET"], message: "Production signing keys require at least 32 characters after trimming; generate a random key" });
  }
  if (!value.REDIS_URL.startsWith("rediss://")) {
    ctx.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Production requires rediss:// (TLS)" });
  }
  if (!value.CORS_ORIGIN.startsWith("https://")) {
    ctx.addIssue({ code: "custom", path: ["CORS_ORIGIN"], message: "Production requires an HTTPS origin" });
  }
}).transform((value) => ({
  ...value,
  APP_ENV: value.APP_ENV ?? value.VERCEL_ENV ?? value.NODE_ENV,
  LOG_LEVEL: value.LOG_LEVEL ?? (value.NODE_ENV === "production" ? "info" : "debug"),
}));
