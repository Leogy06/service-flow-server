import bcrypt from "bcryptjs";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { bootstrapSystemAdminInTransaction, systemAdminBootstrapSchema } from "../../src/modules/system-admin/bootstrap.js";
import { seedPermissionCatalog } from "./permission-catalog.js";

/** Minimum production setup: global definitions, a platform identity/role and required audits. */
export async function seedProduction(prisma: PrismaClient, operator: unknown, dryRun = true) {
  const parsed = systemAdminBootstrapSchema.safeParse(operator);
  if (!parsed.success) throw new Error("Set valid SYSTEM_ADMIN_EMAIL, SYSTEM_ADMIN_PASSWORD (14-72 bytes) and SYSTEM_ADMIN_REASON (10-1000 characters) in the selected environment. No credentials are printed.");
  const input = parsed.data;
  const passwordHash = dryRun ? undefined : await bcrypt.hash(input.SYSTEM_ADMIN_PASSWORD, 12);
  return prisma.$transaction(async (db) => {
    const systemAdmin = await bootstrapSystemAdminInTransaction(db, input, { dryRun, preserveExisting: true, passwordHash });
    const permissions = await seedPermissionCatalog(db, dryRun);
    return { dryRun, systemAdmin, permissions };
  }, { isolationLevel: "Serializable", maxWait: 10000, timeout: 60000 });
}
