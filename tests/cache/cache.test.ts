import { jest } from "@jest/globals";

let now = 0;
const entries = new Map<string, { value: string; expires?: number }>();
const redis = {
  get: jest.fn(async (key: string) => {
    const row = entries.get(key);
    if (row?.expires !== undefined && row.expires <= now) {
      entries.delete(key);
      return null;
    }
    return row?.value ?? null;
  }),
  set: jest.fn(async (key: string, value: string, _mode: string, ttl: number) => {
    entries.set(key, { value, expires: now + ttl * 1000 });
    return "OK";
  }),
  incr: jest.fn(async (key: string) => {
    const value = Number(entries.get(key)?.value ?? 0) + 1;
    entries.set(key, { value: String(value) });
    return value;
  }),
  scan: jest.fn(async (_cursor: string, _match: string, pattern: string, _count: string, _size: number): Promise<[string, string[]]> => {
    const prefix = pattern.slice(0, -1);
    return ["0", [...entries.keys()].filter((key) => key.startsWith(prefix))];
  }),
  del: jest.fn(async (...keys: string[]) => keys.reduce((count, key) => count + Number(entries.delete(key)), 0)),
};
const logger = { error: jest.fn() };
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger }));
const { Prisma } = await import("@/generated/prisma/client.js");
const { getOrSetCache, invalidateCache } = await import("@/utils/cache.js");
const { cachedRead, invalidateModuleCache, invalidating } = await import("@/utils/module-cache.js");
const { requestContext } = await import("@/lib/requestContext.js");
const tenant = <T>(work: () => T, organizationId = "org-a", userId = "staff-a", permissions = ["job:read"]) =>
  requestContext.run({ requestId: "cache-test", organizationId, userId, role: "Staff", permissions }, work);

beforeEach(() => { entries.clear(); now = 0; jest.clearAllMocks(); });

test("cache hits preserve Date, exact Decimal, nested JSON and HTTP serialization", async () => {
  const data = { createdAt: new Date("2026-10-18T01:00:00Z"), amount: new Prisma.Decimal("123456789.99"),
    nested: [null, { type: "date", value: "ordinary user metadata" }], optional: undefined, count: 4n };
  const load = jest.fn(async () => data);
  await getOrSetCache("types", 300, load);
  const hit = await getOrSetCache("types", 300, load);
  expect(load).toHaveBeenCalledTimes(1);
  expect(hit).toEqual(data);
  expect(hit.createdAt.getTime()).toBe(data.createdAt.getTime());
  expect(hit.amount.sub("0.01").toFixed(2)).toBe("123456789.98");
  expect(JSON.stringify({ createdAt: hit.createdAt, amount: hit.amount })).toBe(JSON.stringify({ createdAt: data.createdAt, amount: data.amount }));
});

test("entries expire according to their TTL", async () => {
  const load = jest.fn(async () => ({ value: load.mock.calls.length }));
  expect(await getOrSetCache("ttl", 30, load)).toEqual({ value: 1 });
  now = 29_999;
  expect(await getOrSetCache("ttl", 30, load)).toEqual({ value: 1 });
  now++;
  expect(await getOrSetCache("ttl", 30, load)).toEqual({ value: 2 });
});

test("database errors propagate without caching a failure", async () => {
  await expect(getOrSetCache("failure", 300, async () => { throw new Error("Database unavailable"); })).rejects.toThrow("Database unavailable");
  expect(redis.set).not.toHaveBeenCalled();
});

test("Redis read, write and invalidation failures do not fail database work", async () => {
  redis.get.mockRejectedValueOnce(new Error("Redis unavailable"));
  expect(await getOrSetCache("down", 300, async () => "database value")).toBe("database value");
  expect(redis.set).not.toHaveBeenCalled();
  redis.set.mockRejectedValueOnce(new Error("Redis unavailable"));
  expect(await getOrSetCache("write-down", 300, async () => "fresh")).toBe("fresh");
  redis.incr.mockRejectedValueOnce(new Error("Redis unavailable"));
  await expect(invalidateModuleCache("jobs", "org-a")).resolves.toBeUndefined();
  expect(logger.error).toHaveBeenCalled();
});

test.each(["{corrupted", JSON.stringify({ createdAt: "legacy JSON-only value" })])("invalid cache payloads are refilled: %s", async (value) => {
  entries.set("corrupt", { value });
  expect(await getOrSetCache("corrupt", 300, async () => ({ safe: true }))).toEqual({ safe: true });
  expect(redis.set).toHaveBeenCalledTimes(1);
});

test("invalidation scans all cursor pages rather than blocking Redis with KEYS", async () => {
  redis.scan.mockResolvedValueOnce(["7", ["page-1"]]).mockResolvedValueOnce(["0", ["page-2"]]);
  await invalidateCache("page-*");
  expect(redis.scan.mock.calls.map(([cursor]) => cursor)).toEqual(["0", "7"]);
  expect(redis.del.mock.calls).toEqual([["page-1"], ["page-2"]]);
});

test("tenant, mine-user, permission, role and query variants cannot share cache entries", async () => {
  const load = jest.fn(async () => ({ result: load.mock.calls.length }));
  const read = (query: object = {}) => cachedRead("jobs", "list", query, load);
  expect(await tenant(() => read({ mine: true }))).toEqual({ result: 1 });
  expect(await tenant(() => read({ mine: true }))).toEqual({ result: 1 });
  await tenant(() => read({ mine: true }), "org-b");
  await tenant(() => read({ mine: true }), "org-a", "staff-b");
  await tenant(() => read({ mine: true }), "org-a", "staff-a", ["job:read", "invoice:read"]);
  await tenant(() => read({ mine: false }));
  await requestContext.run({ requestId: "role-change", organizationId: "org-a", userId: "staff-a", role: "Manager", permissions: ["job:read"] }, read);
  expect(load).toHaveBeenCalledTimes(6);
  // User search text is hashed, never interpolated into a Redis key/pattern.
  await tenant(() => read({ search: "private@example.com:*" }));
  expect(redis.set.mock.calls.at(-1)?.[0]).not.toContain("private@example.com");
});

test("permission ordering does not produce duplicate cache entries", async () => {
  const load = jest.fn(async () => 1);
  await tenant(() => cachedRead("dashboard", "get", [], load), "org-a", "a", ["job:read", "invoice:read"]);
  await tenant(() => cachedRead("dashboard", "get", [], load), "org-a", "a", ["invoice:read", "job:read"]);
  expect(load).toHaveBeenCalledTimes(1);
});

test("customer changes invalidate related tenant views while another tenant stays cached", async () => {
  const modules = ["customers", "serviceRequests", "jobs", "invoices", "dashboard"] as const;
  const load = jest.fn(async () => "value");
  for (const module of modules) {
    await tenant(() => cachedRead(module, "list", {}, load));
    await tenant(() => cachedRead(module, "list", {}, load), "org-b");
  }
  await tenant(() => invalidating("customers", async () => "committed"));
  for (const module of modules) {
    await tenant(() => cachedRead(module, "list", {}, load));
    await tenant(() => cachedRead(module, "list", {}, load), "org-b");
  }
  expect(load).toHaveBeenCalledTimes(15);
  expect(redis.incr.mock.calls.every(([key]) => key.endsWith(":org-a"))).toBe(true);
});

test("cache invalidation runs after successful work and skips rejected transactions", async () => {
  await tenant(() => invalidating("invoices", async () => {
    expect(redis.incr).not.toHaveBeenCalled();
    return "committed";
  }));
  expect(redis.incr).toHaveBeenCalled();
  jest.clearAllMocks();
  await expect(tenant(() => invalidating("invoices", async () => { throw new Error("audit rollback"); }))).rejects.toThrow("audit rollback");
  expect(redis.incr).not.toHaveBeenCalled();
});

test("a pre-mutation fetch finishing later cannot refill the current generation with stale data", async () => {
  let release!: (value: string) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const pending = tenant(() => cachedRead("invoices", "get", "invoice-a", () => {
    started();
    return new Promise<string>((resolve) => { release = resolve; });
  }));
  await ready;
  await tenant(() => invalidateModuleCache("invoices"));
  release("old balance");
  expect(await pending).toBe("old balance");
  const load = jest.fn(async () => "new balance");
  expect(await tenant(() => cachedRead("invoices", "get", "invoice-a", load))).toBe("new balance");
  expect(load).toHaveBeenCalledTimes(1);
});

test("shared plan edits invalidate eligible-plan choices across tenants using a global generation", async () => {
  const load = jest.fn(async () => "plans");
  for (const org of ["org-a", "org-b"])
    await tenant(() => cachedRead("upgradePlans", "plans", [], load), org);
  await requestContext.run({ requestId: "platform", userId: "operator" }, () => invalidateModuleCache("plans"));
  for (const org of ["org-a", "org-b"])
    await tenant(() => cachedRead("upgradePlans", "plans", [], load), org);
  expect(load).toHaveBeenCalledTimes(4);
  expect(redis.incr).toHaveBeenCalledWith("cache:generation:modules:v1:upgradePlans");
});
