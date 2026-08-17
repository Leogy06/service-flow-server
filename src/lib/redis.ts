import { Redis } from "ioredis";
import { env } from "@/config/env.js";
import { logger } from "@/lib/logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

redis.on("connect", () => logger.info("Redis connected!"));
redis.on("error", (err) => logger.error({ err }, "Redis connection error"));
