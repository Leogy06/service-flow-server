import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/requestContext";
import { auditService } from "@/modules/audit/audit.service";
import { recordPlatformAudit } from "@/modules/system-admin/platform-audit";
import { AppError } from "@/utils/AppError";
import { hashToken } from "@/utils/tokens";
import { loadAuthorization } from "./authorization";

export type TrustedDeviceCookies = {
  trustedDeviceTenant?: string;
  trustedDeviceAdmin?: string;
};

export { revokeAuthenticationFactors, revokeOrganizationAuthenticationFactors } from "./authentication-factors";

async function self(db: Prisma.TransactionClient) {
  const userId = requestContext.getValue("userId");
  if (!userId) throw new AppError(401, "Authentication is required");
  const user = await loadAuthorization(userId, db);
  if (
    user.organizationId !== (requestContext.getValue("organizationId") ?? null) ||
    (!user.organizationId && user.platformRole !== "SYSTEM_ADMIN")
  ) throw new AppError(401, "Session is no longer valid");
  return user;
}

function deviceName(userAgent: string) {
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /Firefox\//.test(userAgent) ? "Firefox"
      : /(?:Chrome|CriOS)\//.test(userAgent) ? "Chrome"
        : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const platform = /(?:iPhone|iPad)/.test(userAgent) ? "iOS"
    : /Android/.test(userAgent) ? "Android"
      : /Windows/.test(userAgent) ? "Windows"
        : /Macintosh/.test(userAgent) ? "macOS"
          : /Linux/.test(userAgent) ? "Linux" : "Unknown device";
  return `${browser} on ${platform}`;
}

function isCurrent(device: { surface: string; tokenHash: string }, cookies: TrustedDeviceCookies) {
  const raw = device.surface === "system-admin" ? cookies.trustedDeviceAdmin : cookies.trustedDeviceTenant;
  return typeof raw === "string" && raw.length > 0 && hashToken(raw) === device.tokenHash;
}

async function auditRevocation(db: Prisma.TransactionClient, user: Awaited<ReturnType<typeof self>>, id: string, count: number) {
  const input = {
    action: "auth.2fa.device.revoked",
    entity: "TrustedDevice",
    entityId: id,
    after: { devicesRevoked: count },
  };
  if (user.platformRole === "SYSTEM_ADMIN") {
    await recordPlatformAudit(db, { ...input, organizationId: user.organizationId, actorType: "SYSTEM_ADMIN" });
  } else {
    await auditService.recordInTransaction(db, input);
  }
}

export const trustedDeviceService = {
  list(cookies: TrustedDeviceCookies = {}) {
    return prisma.$transaction(async (db) => {
      const user = await self(db);
      const devices = await db.trustedDevice.findMany({
        where: { userId: user.id, organizationId: user.organizationId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, tokenHash: true, userAgent: true, ipAddress: true, surface: true, createdAt: true, lastUsedAt: true, expiresAt: true },
        orderBy: [{ lastUsedAt: "desc" }, { id: "asc" }],
      });
      return devices.map(({ tokenHash, ...device }) => ({
        ...device,
        name: deviceName(device.userAgent),
        isCurrent: isCurrent({ tokenHash, surface: device.surface }, cookies),
      }));
    }, { isolationLevel: "RepeatableRead" });
  },

  revoke(id: string, cookies: TrustedDeviceCookies = {}) {
    return prisma.$transaction(async (db) => {
      const user = await self(db);
      const scope = { id, userId: user.id, organizationId: user.organizationId, revokedAt: null, expiresAt: { gt: new Date() } };
      const device = await db.trustedDevice.findFirst({ where: scope, select: { tokenHash: true, surface: true } });
      if (!device) throw new AppError(404, "Trusted device not found");
      const result = await db.trustedDevice.updateMany({ where: scope, data: { revokedAt: new Date() } });
      if (result.count !== 1) throw new AppError(404, "Trusted device not found");
      await auditRevocation(db, user, id, result.count);
      return { devicesRevoked: result.count, clearSurface: isCurrent(device, cookies) ? device.surface : null };
    }, { isolationLevel: "Serializable" });
  },

  revokeAll() {
    return prisma.$transaction(async (db) => {
      const user = await self(db);
      const result = await db.trustedDevice.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditRevocation(db, user, user.id, result.count);
      return { devicesRevoked: result.count };
    }, { isolationLevel: "Serializable" });
  },
};
