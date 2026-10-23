import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requestContext } from "@/lib/requestContext";
import { tenantTransaction } from "@/utils/tenant-transaction";
import { parseAccountRecoveryArguments, recoverAccountEmailInTransaction } from "./account-recovery";

// Requires server/database operator access and out-of-band identity verification.
try {
  const { input, apply } = parseAccountRecoveryArguments(process.argv.slice(2));
  const result = await requestContext.run({ requestId: randomUUID() }, () =>
    tenantTransaction((db) => recoverAccountEmailInTransaction(db, input, { apply })),
  );
  console.info(result.status === "recovered"
    ? "Account email recovered. Sign in normally with the existing password and verify the code sent to the new email."
    : "Dry run passed. No account changes made. Repeat with --apply after identity verification to recover the account.");
} catch {
  console.error("Recovery failed. Supply --email=..., --new-email=..., --reason=... and --identity-verified; confirm an active account, unused replacement email and database access. No credentials are printed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
