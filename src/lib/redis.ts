import { Redis } from "ioredis";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

// Upstash uses a rediss:// TCP URL; ioredis enables verified TLS automatically.
// Keep this shared client for both tenant-scoped caches and API rate limiting.
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

redis.on("ready", () => logger.info("Redis ready"));
// Redis errors may carry the failed AUTH command and its password in command.args.
redis.on("error", (err: Error) => logger.error({ message: err.message }, "Redis connection error"));
