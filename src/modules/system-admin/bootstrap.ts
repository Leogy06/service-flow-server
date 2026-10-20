import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requestContext } from "@/lib/requestContext";
import { recordPlatformAudit } from "./platform-audit";

export const systemAdminBootstrapSchema = z.object({
  SYSTEM_ADMIN_EMAIL: z.string().trim().toLowerCase().max(191).pipe(z.email()),
  SYSTEM_ADMIN_PASSWORD: z.string().min(14).max(72).refine((value) => Buffer.byteLength(value, "utf8") <= 72),
  SYSTEM_ADMIN_REASON: z.string().trim().min(10).max(1000),
});
type BootstrapInput = z.infer<typeof systemAdminBootstrapSchema>;

/** Explicit operator provisioning; never promote an identity or reset credentials by email. */
export async function bootstrapSystemAdminInTransaction(db: Prisma.TransactionClient, input: BootstrapInput,
  { dryRun = false, preserveExisting = false, passwordHash }: { dryRun?: boolean; preserveExisting?: boolean; passwordHash?: string } = {}) {
  const existing = await db.user.findUnique({ where: { email: input.SYSTEM_ADMIN_EMAIL }, select: {
    id: true, organizationId: true, platformRole: true, status: true, securityStatus: true, deletedAt: true,
    role: { select: { organizationId: true, deletedAt: true } },
  } });
  if (existing) {
    if (!preserveExisting || existing.organizationId !== null || existing.platformRole !== "SYSTEM_ADMIN" ||
        existing.role.organizationId !== null || existing.role.deletedAt || existing.deletedAt ||
        existing.status !== "ACTIVE" || existing.securityStatus !== "ACTIVE") {
      throw new Error("The operator email is already in use or inactive. Existing accounts are never promoted, reactivated or overwritten.");
    }
    return { status: "preserved" as const };
  }
  if (dryRun) return { status: "would-create" as const };
  if (!passwordHash) throw new Error("A hashed operator password is required for provisioning.");
  const role = await db.role.findFirst({ where: { name: "Platform operator", organizationId: null, deletedAt: null } })
    ?? await db.role.create({ data: { name: "Platform operator", organizationId: null } });
  const user = await db.user.create({ data: {
    email: input.SYSTEM_ADMIN_EMAIL, password: passwordHash, firstName: "Platform", lastName: "Administrator",
    roleId: role.id, organizationId: null, platformRole: "SYSTEM_ADMIN", status: "ACTIVE",
  }, select: { id: true } });
  await requestContext.run({ requestId: randomUUID(), userId: user.id }, () => recordPlatformAudit(db, {
    action: "platform.admin.bootstrap", entity: "User", entityId: user.id,
    after: { platformRole: "SYSTEM_ADMIN", reason: input.SYSTEM_ADMIN_REASON },
  }));
  return { status: "created" as const };
}
