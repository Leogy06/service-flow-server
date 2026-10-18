import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_HOST: z.string().min(1),
  DATABASE_PORT: z.coerce.number().default(3306),
  DATABASE_USER: z.string().min(1),
  DATABASE_PASSWORD: z.string().min(1),
  DATABASE_NAME: z.string().min(1),
  CORS_ORIGIN: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  ACCESS_TOKEN_EXPIRY: z.coerce.number().default(900),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(7),

  //bcrypt
  SALT_ROUNDS: z.coerce.number().default(10),

  //redis
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
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
    .enum(["trace", "debug", "info", "warn", "error", "fatal"]),
  LOG_MAX_FILES: z.coerce.number().int().positive().default(14),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "❌ Invalid environment variables:",
    parsed.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const env = parsed.data;
