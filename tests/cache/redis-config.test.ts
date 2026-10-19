import { Redis } from "ioredis";
import { redisUrlSchema } from "@/config/redis-url";

test.each([
  "redis://localhost:6379",
  "redis://:sample@redis:6379",
  "rediss://default:sample@sample.upstash.io:6379",
  "rediss://:sample@sample.upstash.io:6379",
  "rediss://default:sample@sample.upstash.com:6379",
])("accepts Redis TCP configuration: %s", (url) => {
  expect(redisUrlSchema.parse(url)).toBe(url);
});

test.each([
  "",
  "not-a-url",
  "https://sample.upstash.io",
  "redis:///missing-host",
  "redis://default:sample@sample.upstash.io:6379",
  "redis://default:sample@SAMPLE.UPSTASH.IO:6379",
  "redis://default:sample@sample.upstash.io.:6379",
  "rediss://default@sample.upstash.io:6379",
])("rejects invalid transport or missing Upstash credentials: %s", (url) => {
  expect(redisUrlSchema.safeParse(url).success).toBe(false);
});

test("validation errors never include the supplied credential", () => {
  const result = redisUrlSchema.safeParse("https://default:private-sample-password@sample.upstash.io");
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(JSON.stringify(result.error.flatten())).not.toContain("private-sample-password");
  }
});

test.each([
  ["rediss://default:sample@sample.upstash.io:6379", true],
  ["redis://localhost:6379", false],
] as const)("ioredis selects TLS from %s without connecting", (url, tls) => {
  const client = new Redis(redisUrlSchema.parse(url), { lazyConnect: true });
  try {
    expect(Boolean(client.options.tls)).toBe(tls);
    expect(client.options.tls && client.options.tls.rejectUnauthorized).not.toBe(false);
    expect(client.status).toBe("wait");
  } finally {
    client.disconnect();
  }
});
