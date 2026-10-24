import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { RecoverableRateLimitStore } from "@/lib/rate-limit-store";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";

const verifiedAccounts = new WeakMap<Request, string>();
const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");
const limitReached = (_req: Request, res: Response, next: NextFunction) => {
  const error = new AppError(429, "Too many requests, please try again later.", "RATE_LIMITED");
  error.retryAfterSeconds = Math.max(1, Number(res.getHeader("Retry-After")) || 1); next(error);
};

function factorLimiter(name: string, windowMs: number, limit: number, keyGenerator: (req: Request) => string | Promise<string>) {
  return rateLimit({
    windowMs, limit, standardHeaders: "draft-6", legacyHeaders: false,
    store: new RecoverableRateLimitStore(name, `rl:${env.APP_ENV}:${name}:`, false),
    passOnStoreError: false, keyGenerator, handler: limitReached,
    skip: req => req.method === "OPTIONS", validate: { trustProxy: false, xForwardedForHeader: false },
  });
}

// Both password-login and resend share budgets; restarting login cannot bypass resend limits.
export const twoFactorDeliveryIpLimiter = factorLimiter("two-factor-delivery-ip", 3600000, env.TWO_FACTOR_SEND_MAX_PER_HOUR ?? 5, ipKey);
const twoFactorDeliveryAccountLimiter = factorLimiter("two-factor-delivery-account", 3600000, env.TWO_FACTOR_SEND_MAX_PER_HOUR ?? 5, req => {
  const userId = verifiedAccounts.get(req);
  if (!userId) throw new AppError(500, "Verified delivery identity is required");
  return `u:${userId}`;
});

/** Apply the shared Redis policy after server-side credential/challenge proof. */
export async function limitTwoFactorDelivery(req: Request, res: Response, verifiedUserId: string): Promise<void> {
  verifiedAccounts.set(req, verifiedUserId);
  try {
    await new Promise<void>((resolve, reject) => {
      Promise.resolve(twoFactorDeliveryAccountLimiter(req, res, error => error ? reject(error) : resolve())).catch(reject);
    });
  } finally { verifiedAccounts.delete(req); }
}
export const twoFactorVerifyLimiter = factorLimiter("two-factor-verify", env.TWO_FACTOR_VERIFY_RATE_LIMIT_WINDOW_MS ?? 600000, env.TWO_FACTOR_VERIFY_RATE_LIMIT_MAX ?? 30, ipKey);
