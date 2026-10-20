import type { Prisma } from "../../src/generated/prisma/client.js";
import { PERMISSIONS } from "../../src/constants/permission.constants.js";
import { recordPlatformAudit } from "../../src/modules/system-admin/platform-audit.js";

/** Insert global definitions only; tenant assignments and existing descriptions are preserved. */
export async function seedPermissionCatalog(db: Prisma.TransactionClient, dryRun = true) {
  const names = [...new Set(Object.values(PERMISSIONS))];
  const permissions = await db.permission.findMany({ where: { name: { in: names } } });
  if (permissions.some((permission) => permission.organizationId !== null)) {
    throw new Error("Catalog permission name conflicts with a tenant-owned definition; no changes applied.");
  }
  const missing = names.filter((name) => !permissions.some((permission) => permission.name === name));
  if (!dryRun) {
    for (const name of missing) {
      const permission = await db.permission.create({
        data: { name, description: "Can " + name.replace(":", " "), organizationId: null },
      });
      await recordPlatformAudit(db, { action: "platform.permission.seed", entity: "Permission", entityId: permission.id,
        actorType: "OPERATOR", after: { name, source: "prisma/seeds/permission-catalog.ts" } });
    }
  }
  return { create: missing, preserved: permissions.length };
}
