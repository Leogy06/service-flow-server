import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { recordPlatformAudit } from "@/modules/system-admin/platform-audit";
import { AppError } from "@/utils/AppError";
import { revokeAuthenticationFactors } from "./authentication-factors";

const email = z.string().trim().toLowerCase().max(191).pipe(z.email());
export const accountRecoverySchema = z.object({
  email,
  newEmail: email,
  reason: z.string().trim().min(10).max(1000),
  identityVerified: z.literal(true),
}).strict().refine((input) => input.email !== input.newEmail, { message: "The replacement email must differ from the current email" });

export function parseAccountRecoveryArguments(args: string[]) {
  const values: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg === "--identity-verified" || arg === "--apply") {
      if (values[arg] !== undefined) throw new Error("Duplicate recovery argument");
      values[arg] = true;
      continue;
    }
    const match = /^--(email|new-email|reason)=(.+)$/.exec(arg);
    if (!match || values[match[1]!] !== undefined) throw new Error("Unknown or duplicate recovery argument");
    values[match[1]!] = match[2]!;
  }
  return {
    input: accountRecoverySchema.parse({ email: values.email, newEmail: values["new-email"], reason: values.reason, identityVerified: values["--identity-verified"] }),
    apply: values["--apply"] === true,
  };
}

/** Server-operator recovery only. This function is deliberately absent from HTTP routes. */
export async function recoverAccountEmailInTransaction(
  db: Prisma.TransactionClient,
  rawInput: z.infer<typeof accountRecoverySchema>,
  { apply = false }: { apply?: boolean } = {},
) {
  const input = accountRecoverySchema.parse(rawInput);
  const user = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, organizationId: true, platformRole: true, status: true, securityStatus: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.status !== "ACTIVE" || user.securityStatus !== "ACTIVE") {
    throw new AppError(409, "Recovery requires an active, unblocked account");
  }
  const collision = await db.user.findUnique({ where: { email: input.newEmail }, select: { id: true } });
  if (collision) throw new AppError(409, "The replacement email is already in use");
  if (!apply) return { status: "would-recover" as const, userId: user.id };
  const updated = await db.user.updateMany({
    where: { id: user.id, email: input.email, organizationId: user.organizationId, status: "ACTIVE", securityStatus: "ACTIVE", deletedAt: null },
    data: { email: input.newEmail, sessionVersion: { increment: 1 }, inviteToken: null, inviteTokenExpiry: null },
  });
  if (updated.count !== 1) throw new AppError(409, "The account changed. Recheck identity before retrying");
  const sessions = await db.refreshToken.deleteMany({ where: { userId: user.id } });
  const factors = await revokeAuthenticationFactors(db, user.id);
  await recordPlatformAudit(db, {
    action: "auth.2fa.account.recovered",
    actorType: "OPERATOR",
    entity: "User",
    entityId: user.id,
    organizationId: user.organizationId,
    before: { email: input.email },
    after: { email: input.newEmail, reason: input.reason, identityVerified: true, sessionsRevoked: sessions.count, ...factors },
  });
  return { status: "recovered" as const, userId: user.id };
}
