import { createHash } from "node:crypto";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { RecoverableRateLimitStore } from "@/lib/rate-limit-store";
import { env } from "@/config/env";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
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
export const twoFactorDeliveryAccountLimiter = factorLimiter("two-factor-delivery-account", 3600000, env.TWO_FACTOR_SEND_MAX_PER_HOUR ?? 5, async req => {
  if (typeof req.body?.email === "string") {
    const email = req.body.email.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
    return user ? `u:${user.id}` : `e:${hash(email)}`;
  }
  const handle = typeof req.body?.challengeId === "string" ? req.body.challengeId : "";
  const challenge = await prisma.loginChallenge.findUnique({ where: { challengeHash: hash(handle) }, select: { userId: true } });
  return challenge ? `u:${challenge.userId}` : `unknown:${ipKey(req)}`;
});
export const twoFactorVerifyLimiter = factorLimiter("two-factor-verify", env.TWO_FACTOR_VERIFY_RATE_LIMIT_WINDOW_MS ?? 600000, env.TWO_FACTOR_VERIFY_RATE_LIMIT_MAX ?? 30, ipKey);
