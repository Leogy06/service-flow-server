import { z } from "zod";

const positiveInteger = (fallback: number) => z.coerce.number().int().positive().default(fallback);

// Keep all request budgets together so middleware and test fixtures use the same contract.
export const rateLimitEnvironmentSchema = z.object({
  APP_ENV: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/, "Must be a safe environment name (letters, numbers, underscores or hyphens)").optional(),
  VERCEL_ENV: z.enum(["dev", "development", "preview", "production"]).optional(),
  API_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 1000),
  API_RATE_LIMIT_MAX: positiveInteger(300),
  PUBLIC_API_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 1000),
  PUBLIC_API_RATE_LIMIT_MAX: positiveInteger(60),
  AUTH_RATE_LIMIT_WINDOW_MS: positiveInteger(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: positiveInteger(10),
  TWO_FACTOR_VERIFY_RATE_LIMIT_WINDOW_MS: positiveInteger(10 * 60 * 1000),
  TWO_FACTOR_VERIFY_RATE_LIMIT_MAX: positiveInteger(30),
  REFRESH_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 1000),
  REFRESH_RATE_LIMIT_MAX: positiveInteger(60),
  STRICT_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 60 * 1000),
  STRICT_RATE_LIMIT_MAX: positiveInteger(5),
  WRITE_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 1000),
  WRITE_RATE_LIMIT_MAX: positiveInteger(30),
  PUBLIC_WRITE_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 60 * 1000),
  PUBLIC_WRITE_RATE_LIMIT_MAX: positiveInteger(30),
  DELETE_RATE_LIMIT_WINDOW_MS: positiveInteger(15 * 60 * 1000),
  DELETE_RATE_LIMIT_MAX: positiveInteger(5),
  REFUND_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 60 * 1000),
  REFUND_RATE_LIMIT_MAX: positiveInteger(10),
  SIGNUP_RATE_LIMIT_WINDOW_MS: positiveInteger(10 * 60 * 1000),
  SIGNUP_RATE_LIMIT_MAX: positiveInteger(5),
  FEEDBACK_RATE_LIMIT_WINDOW_MS: positiveInteger(10 * 60 * 1000),
  FEEDBACK_RATE_LIMIT_MAX: positiveInteger(20),
  BRANDING_UPLOAD_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 1000),
  BRANDING_UPLOAD_RATE_LIMIT_MAX: positiveInteger(10),
  BRANDING_ASSET_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 1000),
  BRANDING_ASSET_RATE_LIMIT_MAX: positiveInteger(60),
  PUBLIC_PAGE_RATE_LIMIT_WINDOW_MS: positiveInteger(60 * 1000),
  PUBLIC_PAGE_RATE_LIMIT_MAX: positiveInteger(60),
});
