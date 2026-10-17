import "dotenv/config";
import { processPlatformAlerts } from "./operations.service";
import { prisma } from "@/lib/prisma";
import { redis } from "@/lib/redis";
let cursor: string | undefined;
try {
  let batches = 0;
  do {
    const result = await processPlatformAlerts(cursor);
    cursor = result.nextCursor ?? undefined;
    batches++;
    if (batches >= 1000 && cursor)
      throw new Error("Alert scan exceeds per-run bound");
  } while (cursor);
  console.info("Platform alert scan completed");
} catch {
  console.error(
    "Platform alert scan failed; rerun safely to resume processing.",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  redis.disconnect();
}
