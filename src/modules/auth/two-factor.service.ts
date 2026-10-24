import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Prisma, LoginChallenge } from "@/generated/prisma/client";
import { env } from "@/config/env";
import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/requestContext";
import { sendLoginCodeEmail } from "@/lib/email/send-login-code";
import { recordPlatformAudit } from "@/modules/system-admin/platform-audit";
import { AppError } from "@/utils/AppError";
import { tenantTransaction } from "@/utils/tenant-transaction";
import { loadAuthorization, type AuthorizationUser } from "./authorization";
import { createLoginSession } from "./login-session";

type Surface = "tenant" | "system-admin";
export type LoginHints = { userAgent: string; ipAddress: string; trustedTokens: Partial<Record<Surface, string>> };
export type CompletedLogin = Awaited<ReturnType<typeof createLoginSession>> & {
  trustedDevice?: { token: string; surface: Surface; days: number };
};
type IssuedCode = { challenge: LoginChallenge; challengeId: string; code: string; user: AuthorizationUser };

const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");
const surfaceOf = (user: AuthorizationUser): Surface => user.platformRole === "SYSTEM_ADMIN" ? "system-admin" : "tenant";
const trustDays = (surface: Surface) => surface === "tenant" ? (env.TRUSTED_DEVICE_TENANT_DAYS ?? 30) : (env.TRUSTED_DEVICE_ADMIN_DAYS ?? 7);
const invalidCode = () => new AppError(400, "Invalid or expired verification code. Request a new code if needed.", "INVALID_VERIFICATION_CODE");

function codeDigest(challengeId: string, code: string) {
  // A server-held key prevents offline enumeration of a short numeric code from a database dump.
  return createHmac("sha256", env.TWO_FACTOR_SECRET ?? env.JWT_ACCESS_SECRET)
    .update(`login-code:${challengeId}:${code}`).digest("hex");
}

async function audit(db: Prisma.TransactionClient, user: AuthorizationUser, action: string, entityId: string, after: Prisma.InputJsonValue = {}) {
  return requestContext.run({
    ...(requestContext.get() ?? { requestId: "authentication" }),
    userId: user.id, organizationId: user.organizationId ?? undefined,
  }, () => recordPlatformAudit(db, {
    action, entity: "Authentication", entityId, organizationId: user.organizationId,
    actorType: user.platformRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "USER", after,
  }));
}

function throttled(seconds: number): never {
  const error = new AppError(429, "Please wait before requesting another verification code.", "RATE_LIMITED");
  error.retryAfterSeconds = Math.max(1, Math.ceil(seconds)); throw error;
}

async function issue(db: Prisma.TransactionClient, user: AuthorizationUser): Promise<IssuedCode> {
  const now = new Date();
  const last = await db.loginChallenge.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const cooldown = env.TWO_FACTOR_RESEND_SECONDS ?? 60;
  if (last && now.getTime() - last.lastSentAt.getTime() < cooldown * 1000)
    throttled((last.lastSentAt.getTime() + cooldown * 1000 - now.getTime()) / 1000);
  const since = new Date(now.getTime() - 3600000);
  if (await db.loginChallenge.count({ where: { userId: user.id, createdAt: { gt: since } } }) >= (env.TWO_FACTOR_SEND_MAX_PER_HOUR ?? 5)) {
    const oldest = await db.loginChallenge.findFirst({ where: { userId: user.id, createdAt: { gt: since } }, orderBy: { createdAt: "asc" } });
    throttled(oldest ? (oldest.createdAt.getTime() + 3600000 - now.getTime()) / 1000 : 3600);
  }
  const surface = surfaceOf(user);
  await db.loginChallenge.updateMany({ where: { userId: user.id, surface, consumedAt: null }, data: { consumedAt: now } });
  const challengeId = randomBytes(32).toString("base64url");
  const codeLength = env.TWO_FACTOR_CODE_LENGTH ?? 4;
  const code = randomInt(0, 10 ** codeLength).toString().padStart(codeLength, "0");
  const challenge = await db.loginChallenge.create({ data: {
    userId: user.id, organizationId: user.organizationId, surface,
    challengeHash: digest(challengeId), codeHash: codeDigest(challengeId, code), codeLength,
    attempts: 0, maxAttempts: env.TWO_FACTOR_MAX_ATTEMPTS ?? 5, sessionVersion: user.sessionVersion,
    expiresAt: new Date(now.getTime() + (env.TWO_FACTOR_CODE_TTL_SECONDS ?? 600) * 1000),
    createdAt: now, lastSentAt: now, deliveryStatus: "pending",
  } });
  return { challenge, challengeId, code, user };
}

async function deliver(issued: IssuedCode) {
  const { challenge, challengeId, code, user } = issued;
  let deliveryStatus: "sent" | "failed" = "sent";
  try {
    // Never send mail inside a transaction that can be retried after a serialization conflict.
    const organization = user.organizationId ? await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } }) : null;
    await sendLoginCodeEmail(user.email, user.firstName, code, surfaceOf(user), organization?.name,
      Math.ceil((challenge.expiresAt.getTime() - challenge.createdAt.getTime()) / 60000));
  } catch { deliveryStatus = "failed"; }
  await tenantTransaction(async db => {
    await db.loginChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { deliveryStatus } });
    await audit(db, user, deliveryStatus === "sent" ? "auth.2fa.code.sent" : "auth.2fa.code.delivery_failed", challenge.id, { surface: surfaceOf(user) });
  });
  const [local, domain] = user.email.split("@");
  return {
    requiresTwoFactor: true as const, challengeId, maskedEmail: `${local[0]}***@${domain}`,
    codeLength: challenge.codeLength, expiresAt: challenge.expiresAt.toISOString(),
    resendAvailableAt: new Date(challenge.lastSentAt.getTime() + (env.TWO_FACTOR_RESEND_SECONDS ?? 60) * 1000).toISOString(),
    trustedDeviceDays: trustDays(surfaceOf(user)), deliveryStatus,
  };
}

async function challengeUser(db: Prisma.TransactionClient, challenge: LoginChallenge) {
  let user: AuthorizationUser;
  try { user = await loadAuthorization(challenge.userId, db); } catch (error) {
    if (error instanceof AppError && [401, 403].includes(error.statusCode)) throw invalidCode();
    throw error;
  }
  if (user.organizationId !== challenge.organizationId || user.sessionVersion !== challenge.sessionVersion || surfaceOf(user) !== challenge.surface)
    throw invalidCode();
  return user;
}

export const twoFactorService = {
  async beginLogin(credentials: { id: string; password: string }, hints: LoginHints): Promise<CompletedLogin | Awaited<ReturnType<typeof deliver>>> {
    const result = await tenantTransaction(async db => {
      const current = await loadAuthorization(credentials.id, db);
      const verified = await db.user.findFirst({ where: { id: credentials.id, password: credentials.password }, select: { id: true } });
      if (!verified) throw new AppError(401, "Invalid credentials");
      const surface = surfaceOf(current);
      const raw = hints.trustedTokens[surface];
      if (raw) {
        const trusted = await db.trustedDevice.findFirst({ where: {
          tokenHash: digest(raw), userId: current.id, organizationId: current.organizationId,
          surface, userAgent: hints.userAgent.slice(0, 500), revokedAt: null, expiresAt: { gt: new Date() },
        } });
        if (trusted) {
          await db.trustedDevice.update({ where: { id: trusted.id }, data: { lastUsedAt: new Date(), ipAddress: hints.ipAddress.slice(0, 45) } });
          return { session: await createLoginSession(db, current) };
        }
      }
      return { issued: await issue(db, current) };
    });
    return result.session ?? deliver(result.issued!);
  },

  async resend(challengeId: string, beforeDelivery?: (userId: string) => Promise<void>) {
    let deliveryBudget: Promise<void> | undefined;
    const issued = await tenantTransaction(async db => {
      const challenge = await db.loginChallenge.findUnique({ where: { challengeHash: digest(challengeId) } });
      if (!challenge || challenge.createdAt.getTime() + 3600000 <= Date.now()) throw invalidCode();
      const user = await challengeUser(db, challenge);
      const latest = await db.loginChallenge.findFirst({ where: { userId: user.id, surface: challenge.surface }, orderBy: { createdAt: "desc" } });
      if (latest?.id !== challenge.id || (challenge.consumedAt && challenge.attempts < challenge.maxAttempts)) throw invalidCode();
      // Retried transactions revalidate challenge state but charge Redis once.
      // Unknown/stale handles cannot deplete another account's delivery budget.
      if (beforeDelivery) await (deliveryBudget ??= beforeDelivery(user.id));
      return issue(db, user);
    });
    return deliver(issued);
  },

  async verify(challengeId: string, code: string, rememberDevice: boolean, hints: LoginHints): Promise<CompletedLogin> {
    const result = await tenantTransaction(async db => {
      const challenge = await db.loginChallenge.findUnique({ where: { challengeHash: digest(challengeId) } });
      if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= challenge.maxAttempts || challenge.deliveryStatus !== "sent")
        return { error: invalidCode() };
      const user = await challengeUser(db, challenge);
      const expected = Buffer.from(challenge.codeHash, "hex");
      const supplied = Buffer.from(codeDigest(challengeId, code), "hex");
      if (!new RegExp(`^\\d{${challenge.codeLength}}$`).test(code) || !timingSafeEqual(expected, supplied)) {
        const attempts = challenge.attempts + 1;
        await db.loginChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: challenge.attempts }, data: {
          attempts, ...(attempts >= challenge.maxAttempts ? { consumedAt: new Date() } : {}),
        } });
        await audit(db, user, "auth.2fa.code.failed", challenge.id, { attempts, surface: surfaceOf(user) });
        // Return the error so the attempt and audit commit before it is thrown to the client.
        return { error: invalidCode() };
      }
      const consumed = await db.loginChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: challenge.attempts }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) return { error: invalidCode() };
      await audit(db, user, "auth.2fa.code.verified", challenge.id, { surface: surfaceOf(user) });
      let trustedDevice: CompletedLogin["trustedDevice"];
      if (rememberDevice) {
        const surface = surfaceOf(user); const days = trustDays(surface); const token = randomBytes(32).toString("base64url");
        const device = await db.trustedDevice.create({ data: {
          userId: user.id, organizationId: user.organizationId, surface, tokenHash: digest(token),
          userAgent: hints.userAgent.slice(0, 500), ipAddress: hints.ipAddress.slice(0, 45),
          expiresAt: new Date(Date.now() + days * 86400000), lastUsedAt: new Date(),
        } });
        trustedDevice = { token, surface, days };
        await audit(db, user, "auth.2fa.device.trusted", device.id, { surface, days });
      }
      return { session: { ...await createLoginSession(db, user), ...(trustedDevice ? { trustedDevice } : {}) } };
    });
    if (result.error) throw result.error;
    return result.session!;
  },
};
