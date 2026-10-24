import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/utils/AppError";
import {
  generateAccessToken,
  generateRefreshTokenValue,
  hashToken,
  getRefreshExpiry,
} from "@/utils/tokens";
import { recordPlatformAudit } from "@/modules/system-admin/platform-audit";
import { requestContext } from "@/lib/requestContext";
import { loadAuthorization, sessionUser } from "./authorization";
import type { RegisterInput } from "./auth.schema";
import { twoFactorService, type LoginHints } from "./two-factor.service";

export const authService = {
  async register(input: RegisterInput) {
    const { signupService } =
      await import("@/modules/system-admin/signup.service");
    return signupService.submit(input);
  },

  async login(email: string, password: string, hints: LoginHints = { userAgent: "", ipAddress: "", trustedTokens: {} }, beforeDelivery?: (userId: string) => Promise<void>) {
    try {
      const credentials = await prisma.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, password: true },
      });
      if (
        !credentials?.password ||
        !(await bcrypt.compare(password, credentials.password))
      ) {
        throw new AppError(401, "Invalid credentials");
      }
      // Charge a victim's account budget only after password possession is proven.
      // beginLogin still rechecks the credential hash and current authorization.
      await beforeDelivery?.(credentials.id);
      return await twoFactorService.beginLogin({ id: credentials.id, password: credentials.password }, hints);
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.statusCode === 401 || error.statusCode === 403)
      ) {
        await recordPlatformAudit(prisma, {
          action: "auth.login.failure",
          entity: "Authentication",
          entityId: "unknown",
          after: { outcome: "denied" },
        });
      }
      throw error;
    }
  },

  async refresh(rawRefreshToken: string) {
    return prisma.$transaction(
      async (db) => {
        const stored = await db.refreshToken.findUnique({
          where: { token: hashToken(rawRefreshToken) },
        });
        if (!stored || stored.expiresAt <= new Date())
          throw new AppError(401, "Invalid or expired refresh token");
        // Reauthorize inside rotation so concurrent access changes cannot issue a valid replacement.
        const current = await loadAuthorization(stored.userId, db);
        if (stored.organizationId !== current.organizationId)
          throw new AppError(401, "Session is no longer valid");
        const refreshToken = generateRefreshTokenValue();
        await db.refreshToken.delete({ where: { id: stored.id } });
        await db.refreshToken.create({
          data: {
            token: hashToken(refreshToken),
            userId: current.id,
            organizationId: current.organizationId,
            expiresAt: getRefreshExpiry(),
          },
        });
        return {
          accessToken: generateAccessToken(sessionUser(current)),
          refreshToken,
        };
      },
      { isolationLevel: "Serializable" },
    );
  },

  async logout(rawRefreshToken: string) {
    await prisma.$transaction(
      async (db) => {
        const stored = await db.refreshToken.findUnique({
          where: { token: hashToken(rawRefreshToken) },
        });
        if (!stored) return;
        const user = await db.user.findUnique({
          where: { id: stored.userId },
          select: { id: true, platformRole: true, organizationId: true },
        });
        await db.refreshToken.deleteMany({ where: { id: stored.id } });
        if (!user || stored.expiresAt <= new Date()) return;
        await db.user.update({
          where: { id: user.id },
          data: { sessionVersion: { increment: 1 } },
          select: { id: true },
        });
        await requestContext.run(
          {
            ...(requestContext.get() ?? { requestId: "authentication" }),
            userId: user.id,
            organizationId: user.organizationId ?? undefined,
          },
          () =>
            recordPlatformAudit(db, {
              action: "auth.logout.success",
              entity: "User",
              entityId: user.id,
              organizationId: user.organizationId,
              actorType:
                user.platformRole === "SYSTEM_ADMIN" ? "SYSTEM_ADMIN" : "USER",
              after: { sessionsRevoked: 1 },
            }),
        );
      },
      { isolationLevel: "Serializable" },
    );
  },
};
