import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { Request, Response, NextFunction } from "express";
import { redis } from "@/lib/redis";
import { AppError } from "@/utils/AppError";
import { env } from "@/config/env";

function redisStore(prefix: string) {
  return new RedisStore({
    sendCommand: (...args: string[]) =>
      redis.call(args[0] as string, ...args.slice(1)) as Promise<string>,
    prefix: `rl:${prefix}:`,
  });
}

// Shared handler so rate-limit rejections also go through your centralized error format
function limitReached(_req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError(
      429,
      "Too many requests, please try again later.",
      "RATE_LIMITED",
    ),
  );
}

// Strict — login/register/refresh: prevent brute force & credential stuffing
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("auth"),
  handler: limitReached,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

export const signupLimiter = rateLimit({
  windowMs: env.SIGNUP_RATE_LIMIT_WINDOW_MS,
  limit: env.SIGNUP_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("signup"),
  handler: limitReached,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

// Public feedback context, submission and consent withdrawal share an IP budget.
export const feedbackLimiter = rateLimit({
  windowMs: env.FEEDBACK_RATE_LIMIT_WINDOW_MS,
  limit: env.FEEDBACK_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("feedback"),
  handler: limitReached,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

// Looser — general authenticated API traffic
export const apiLimiter = rateLimit({
  // Keep the authorized dependency probe reachable during a Redis outage.
  skip: (req) =>
    req.method === "GET" && req.path === "/system-admin/monitoring",
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("api"),
  handler: limitReached,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
});

// Very strict — password reset / sensitive one-off actions, if you add these later
export const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("strict"),
  handler: limitReached,
});

export const writeLimmiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("write"),
  handler: limitReached,
});

export const refundLimiter = rateLimit({
  windowMs: env.REFUND_RATE_LIMIT_WINDOW_MS,
  limit: env.REFUND_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("refund"),
  handler: limitReached,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
});

export const brandingUploadLimiter = rateLimit({
  windowMs: env.BRANDING_UPLOAD_RATE_LIMIT_WINDOW_MS ?? 60 * 1000,
  limit: env.BRANDING_UPLOAD_RATE_LIMIT_MAX ?? 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("branding-upload"),
  handler: limitReached,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "unknown"),
});

export const brandingAssetLimiter = rateLimit({
  windowMs: env.BRANDING_ASSET_RATE_LIMIT_WINDOW_MS ?? 60 * 1000,
  limit: env.BRANDING_ASSET_RATE_LIMIT_MAX ?? 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("branding-asset"),
  handler: limitReached,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

export const publicPageLimiter = rateLimit({
  windowMs: env.PUBLIC_PAGE_RATE_LIMIT_WINDOW_MS ?? 60 * 1000,
  limit: env.PUBLIC_PAGE_RATE_LIMIT_MAX ?? 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("public-page"),
  handler: limitReached,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
});

export const deleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore("delete"),
  handler: limitReached,
});
