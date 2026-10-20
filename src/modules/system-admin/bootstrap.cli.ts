import { env } from "@/config/env";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/requestContext";
import { recordPlatformAudit } from "./platform-audit";
import { randomUUID } from "node:crypto";

// Operator-only provisioning. Never called by tenant APIs or ordinary seed scripts.
const input = z
  .object({
    SYSTEM_ADMIN_EMAIL: z.email(),
    SYSTEM_ADMIN_PASSWORD: z
      .string()
      .min(14)
      .max(72)
      .refine((v) => Buffer.byteLength(v, "utf8") <= 72),
    SYSTEM_ADMIN_REASON: z.string().trim().min(10).max(1000),
  })
  .parse(env);

try {
  if (!process.argv.includes("--bootstrap-system-admin"))
    throw new Error(
      "Explicit --bootstrap-system-admin acknowledgment required",
    );
  const password = await bcrypt.hash(input.SYSTEM_ADMIN_PASSWORD, 12);
  await prisma.$transaction(
    async (db) => {
      const existing = await db.user.findUnique({
        where: { email: input.SYSTEM_ADMIN_EMAIL },
      });
      if (existing)
        throw new Error(
          "Email already exists. Provision a separate platform identity; existing accounts are never promoted automatically.",
        );
      const role =
        (await db.role.findFirst({
          where: {
            name: "Platform operator",
            organizationId: null,
            deletedAt: null,
          },
        })) ??
        (await db.role.create({
          data: { name: "Platform operator", organizationId: null },
        }));
      const user = await db.user.create({
        data: {
          email: input.SYSTEM_ADMIN_EMAIL,
          password,
          firstName: "Platform",
          lastName: "Administrator",
          roleId: role.id,
          organizationId: null,
          platformRole: "SYSTEM_ADMIN",
          status: "ACTIVE",
        },
      });
      await requestContext.run(
        { requestId: randomUUID(), userId: user.id },
        () =>
          recordPlatformAudit(db, {
            action: "platform.admin.bootstrap",
            entity: "User",
            entityId: user.id,
            after: {
              platformRole: "SYSTEM_ADMIN",
              reason: input.SYSTEM_ADMIN_REASON,
            },
          }),
      );
    },
    { isolationLevel: "Serializable" },
  );
  console.info(
    "Platform administrator provisioned. Sign in through the normal login page.",
  );
} catch {
  console.error(
    "Bootstrap failed. Check operator inputs, database connectivity and that the email is unused. No credentials are printed.",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
