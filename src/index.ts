import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
import { createShutdown } from "./lib/shutdown";

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on http://localhost:${env.PORT}`);
});

// Serverless workers belong to the provider; only the standalone process owns
// OS signals and the shared clients' final lifetime.
if (!process.env.VERCEL) {
  const shutdown = createShutdown(server, async () => {
    const results = await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    if (results.some(result => result.status === "rejected")) throw new Error("Resource cleanup failed");
  }, code => process.exit(code), logger);
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
}
