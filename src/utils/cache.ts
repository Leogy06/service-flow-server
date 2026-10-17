import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { Prisma } from "@/generated/prisma/client";

const DEFAULT_TTL_SECONDS = 300; // 5 min

// Tag containers as well as special values so arbitrary JSON metadata cannot be
// mistaken for a Date/Decimal. Cache hits must retain the fetcher's runtime types.
function encode(value: unknown): unknown {
  if (value instanceof Date) return ["date", value.toISOString()];
  if (Prisma.Decimal.isDecimal(value)) return ["decimal", value.toString()];
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (value === undefined) return ["undefined"];
  if (Array.isArray(value)) return ["array", value.map(encode)];
  if (value !== null && typeof value === "object")
    return ["object", Object.entries(value).map(([key, item]) => [key, encode(item)])];
  return value;
}

function decode(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const [type, data] = value;
  switch (type) {
    case "date": return new Date(data);
    case "decimal": return new Prisma.Decimal(data);
    case "bigint": return BigInt(data);
    case "undefined": return undefined;
    case "array": return data.map(decode);
    case "object": return Object.fromEntries(data.map(([key, item]: [string, unknown]) => [key, decode(item)]));
    default: throw new Error("Unsupported cache value");
  }
}

const generationKey = (namespace: string) => `cache:generation:${namespace}`;

export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  namespaces: readonly string[] = [],
): Promise<T> {
  let storageKey = key;
  let available = true;
  try {
    if (namespaces.length) {
      const versions = await Promise.all(namespaces.map((namespace) => redis.get(generationKey(namespace))));
      storageKey = `${key}:g:${versions.map((version) => version ?? "0").join(":")}`;
    }
    const cached = await redis.get(storageKey);
    if (cached) {
      try {
        const payload = JSON.parse(cached);
        // Old JSON-only entries have incompatible Date/Decimal types; refill them.
        if (payload?.format === 2) return decode(payload.value) as T;
      } catch (err) {
        logger.error({ err, key }, "Invalid cache value, refilling from DB");
      }
    }
  } catch (err) {
    // Redis being down shouldn't break the app — log and fall through to DB
    logger.error({ err, key }, "Cache read failed, falling back to DB");
    available = false;
  }

  const fresh = await fetcher();

  try {
    if (available && fresh !== undefined)
      await redis.set(storageKey, JSON.stringify({ format: 2, value: encode(fresh) }), "EX", ttlSeconds);
  } catch (err) {
    logger.error({ err, key }, "Cache write failed");
  }

  return fresh;
}

export async function invalidateCache(pattern: string, namespace?: string): Promise<void> {
  try {
    // Advance before scanning. An in-flight pre-mutation fetch can only populate
    // its old generation, which subsequent reads will never use.
    if (namespace) await redis.incr(generationKey(namespace));
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    logger.error({ err, pattern }, "Cache invalidation failed");
  }
}

export { DEFAULT_TTL_SECONDS };
