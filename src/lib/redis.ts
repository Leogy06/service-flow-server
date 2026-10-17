import { Redis } from "ioredis";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

redis.on("connect", () => logger.info("Redis connected!"));
redis.on("error", (err) => logger.error({ err }, "Redis connection error"));
