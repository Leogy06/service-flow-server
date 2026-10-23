import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import jwt from "jsonwebtoken";
import { RecoverableRateLimitStore } from "@/lib/rate-limit-store";
import { AppError } from "@/utils/AppError";
import { env } from "@/config/env";

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");
const userKey = (req: Request) => req.user ? `u:${req.user.id}` : ipKey(req);
const skipPreflight = (req: Request) => req.method === "OPTIONS";

function limitReached(_req: Request, res: Response, next: NextFunction): void {
  const error = new AppError(429, "Too many requests, please try again later.", "RATE_LIMITED");
  error.retryAfterSeconds = Math.max(1, Number(res.getHeader("Retry-After")) || 1);
  next(error);
}

function limiter(name: string, windowMs: number, limit: number, keyGenerator = userKey,
  options: { failOpen?: boolean; successfulLogin?: boolean; skip?: (req: Request) => boolean } = {}) {
  const failOpen = options.failOpen === true;
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-6",
    legacyHeaders: false,
    store: new RecoverableRateLimitStore(name, `rl:${env.APP_ENV}:${name}:`, failOpen),
    passOnStoreError: failOpen,
    skipSuccessfulRequests: options.successfulLogin === true,
    // Only a completed login removes its hit; redirects are not successful logins.
    requestWasSuccessful: (_req, res) => res.statusCode >= 200 && res.statusCode < 300,
    skip: (req) => skipPreflight(req) || options.skip?.(req) === true,
    keyGenerator,
    // The deployment trusts its forwarding proxy; IP keys are explicitly supplied above.
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: limitReached,
  });
}

// Failed credentials retain a strict IP budget, separate from signup and refresh.
export const authLimiter = limiter("auth", env.AUTH_RATE_LIMIT_WINDOW_MS, env.AUTH_RATE_LIMIT_MAX, ipKey, { successfulLogin: true });
export const signupLimiter = limiter("signup", env.SIGNUP_RATE_LIMIT_WINDOW_MS, env.SIGNUP_RATE_LIMIT_MAX, ipKey);

function refreshKey(req: Request): string {
  if (req.user) return userKey(req);
  const authorization = req.get("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    try {
      // Signature verification is for bucketing only. The refresh service still
      // enforces expiry/session state using the HTTP-only refresh cookie.
      const payload = jwt.verify(authorization.slice(7), env.JWT_ACCESS_SECRET, { algorithms: ["HS256"], ignoreExpiration: true });
      if (typeof payload === "object" && typeof payload.sub === "string" && payload.sub.length > 0) return `u:${payload.sub}`;
    } catch { /* Invalid or absent bearer tokens share the IP budget. */ }
  }
  return ipKey(req);
}
export const refreshLimiter = limiter("refresh", env.REFRESH_RATE_LIMIT_WINDOW_MS, env.REFRESH_RATE_LIMIT_MAX, refreshKey);
export const feedbackLimiter = limiter("feedback", env.FEEDBACK_RATE_LIMIT_WINDOW_MS, env.FEEDBACK_RATE_LIMIT_MAX, ipKey);
export const publicApiLimiter = limiter("public-api", env.PUBLIC_API_RATE_LIMIT_WINDOW_MS, env.PUBLIC_API_RATE_LIMIT_MAX, ipKey);
// Preserve the existing strict public feedback write budget independently of tenant writes.
export const publicWriteLimiter = limiter("public-write", env.PUBLIC_WRITE_RATE_LIMIT_WINDOW_MS, env.PUBLIC_WRITE_RATE_LIMIT_MAX, ipKey);

// Failed protected authentication cannot bypass the default public abuse budget.
// Public auth routes already have their own strict policies and are not counted twice.
export const unauthenticatedErrorLimiter: ErrorRequestHandler = (error, req, res, next) => {
  const alreadyLimited = /^\/api\/auth\/(?:login|register|refresh|set-password|logout)(?:[/?]|$)/.test(req.originalUrl);
  if (!req.user && error instanceof AppError && error.statusCode === 401 && !alreadyLimited) {
    return publicApiLimiter(req, res, (limitError?: unknown) => next(limitError ?? error));
  }
  return next(error);
};

// Mount after authenticate. originalUrl is stable inside nested routers.
export const apiLimiter = limiter("api", env.API_RATE_LIMIT_WINDOW_MS, env.API_RATE_LIMIT_MAX, userKey, {
  failOpen: true,
  skip: (req) => req.method === "GET" && ["/api/health", "/api/system-admin/monitoring"].includes(req.originalUrl.split("?")[0]!),
});
export const strictLimiter = limiter("strict", env.STRICT_RATE_LIMIT_WINDOW_MS, env.STRICT_RATE_LIMIT_MAX);
export const writeLimiter = limiter("write", env.WRITE_RATE_LIMIT_WINDOW_MS, env.WRITE_RATE_LIMIT_MAX);
// Compatibility for existing route imports.
export { writeLimiter as writeLimmiter };
export const deleteLimiter = limiter("delete", env.DELETE_RATE_LIMIT_WINDOW_MS, env.DELETE_RATE_LIMIT_MAX);
export const refundLimiter = limiter("refund", env.REFUND_RATE_LIMIT_WINDOW_MS, env.REFUND_RATE_LIMIT_MAX);
export const brandingUploadLimiter = limiter("branding-upload", env.BRANDING_UPLOAD_RATE_LIMIT_WINDOW_MS, env.BRANDING_UPLOAD_RATE_LIMIT_MAX);
export const brandingAssetLimiter = limiter("branding-asset", env.BRANDING_ASSET_RATE_LIMIT_WINDOW_MS, env.BRANDING_ASSET_RATE_LIMIT_MAX, ipKey);
export const publicPageLimiter = limiter("public-page", env.PUBLIC_PAGE_RATE_LIMIT_WINDOW_MS, env.PUBLIC_PAGE_RATE_LIMIT_MAX, ipKey);
