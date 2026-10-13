import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { seedDefaultRoles } from "./defaultRoles.js";

// Repair existing tenant Admin roles using the same defaults as the general role seed.
export async function seedAdminRoles(prisma: PrismaClient) {
  const result = await seedDefaultRoles(prisma, true);
  return { adminRoles: result.matchedRoles, updatedRoles: result.updatedRoles, permissionsPerRole: result.permissionsPerRole.Admin };
}
