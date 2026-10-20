import { env } from "@/config/env";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { bootstrapSystemAdminInTransaction, systemAdminBootstrapSchema } from "./bootstrap";

// Operator-only provisioning. Never called by tenant APIs or ordinary seed scripts.
try {
  const input = systemAdminBootstrapSchema.parse(env);
  if (!process.argv.includes("--bootstrap-system-admin"))
    throw new Error(
      "Explicit --bootstrap-system-admin acknowledgment required",
    );
  const password = await bcrypt.hash(input.SYSTEM_ADMIN_PASSWORD, 12);
  await prisma.$transaction(
    (db) => bootstrapSystemAdminInTransaction(db, input, { passwordHash: password }),
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
