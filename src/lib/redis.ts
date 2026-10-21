import { Redis } from "ioredis";
import { env } from "@/config/env";
import { logger } from "@/lib/logger";

// Upstash uses a rediss:// TCP URL; ioredis enables verified TLS automatically.
// Keep this shared client for both tenant-scoped caches and API rate limiting.
const globalForRedis = globalThis as unknown as {
  serviceFlowRedis?: Redis;
  serviceFlowRedisReadiness?: Promise<void>;
};

function createRedis(): Redis {
  const client = new Redis(env.REDIS_URL, {
    connectTimeout: env.REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: env.REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: env.REDIS_MAX_RETRIES_PER_REQUEST,
    // Serverless requests must fail promptly instead of queuing until reconnect.
    enableOfflineQueue: false,
  });
  client.on("ready", () => logger.info("Redis ready"));
  // Redis errors may carry the failed AUTH command and its password in command.args.
  client.on("error", (err: Error) => logger.error({ message: err.message }, "Redis connection error"));
  return client;
}

// One connection and one set of listeners per warm runtime, including module reloads.
export const redis = globalForRedis.serviceFlowRedis ??= createRedis();

// With offline queuing disabled, SCRIPT LOAD must wait for the initial TCP/TLS
// handshake. Share only this bounded connection wait; never queue Redis commands.
export function redisReady(): Promise<void> {
  if (redis.status === "ready") return Promise.resolve();
  if (redis.status === "end") return Promise.reject(new Error("Redis connection is closed"));
  if (globalForRedis.serviceFlowRedisReadiness) return globalForRedis.serviceFlowRedisReadiness;

  const waiting = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      redis.off("ready", onReady);
      redis.off("end", onEnd);
      redis.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onEnd = () => finish(new Error("Redis connection closed before becoming ready"));
    // Keep credentials/command arguments out of propagated connection failures.
    const onError = () => finish(new Error("Redis connection failed before becoming ready"));
    const timeout = setTimeout(() => finish(new Error("Redis connection readiness timed out")), env.REDIS_CONNECT_TIMEOUT_MS);
    redis.once("ready", onReady);
    redis.once("end", onEnd);
    redis.once("error", onError);
  });
  const readiness = waiting.finally(() => {
    if (globalForRedis.serviceFlowRedisReadiness === readiness) delete globalForRedis.serviceFlowRedisReadiness;
  });
  globalForRedis.serviceFlowRedisReadiness = readiness;
  return readiness;
}
