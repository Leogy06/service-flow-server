import { redis } from "@/lib/redis.js";
import { logger } from "@/lib/logger.js";

const DEFAULT_TTL_SECONDS = 300; // 5 min

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    // Redis being down shouldn't break the app — log and fall through to DB
    logger.error({ err, key }, "Cache read failed, falling back to DB");
  }

  const fresh = await fetcher();

  try {
    await redis.set(key, JSON.stringify(fresh), "EX", ttlSeconds);
  } catch (err) {
    logger.error({ err, key }, "Cache write failed");
  }

  return fresh;
}

export async function invalidateCache(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (err) {
    logger.error({ err, pattern }, "Cache invalidation failed");
  }
}

export { DEFAULT_TTL_SECONDS };