import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/utils/AppError";

/** Reload persisted tenant mode before an action that could affect real people or money. */
export async function assertDemoActionAllowed(
  db: Prisma.TransactionClient,
  organizationId: string,
  action: string,
) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { isDemo: true },
  });
  if (!organization) throw new AppError(404, "Organization not found");
  if (organization.isDemo) {
    throw new AppError(403, `Demo workspaces cannot ${action}.`, "DEMO_ACTION_DISABLED");
  }
}
