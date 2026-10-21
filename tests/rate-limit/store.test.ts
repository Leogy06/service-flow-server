import { jest } from "@jest/globals";
import { MemoryStore, rateLimit, type Options } from "express-rate-limit";

// Obtain the installed middleware's complete validated store options without casts.
const memory = new MemoryStore();
let configured: Options | undefined;
const initializeMemory = memory.init.bind(memory);
memory.init = (options: Options) => { configured = options; initializeMemory(options); };
rateLimit({ windowMs: 60000, store: memory });
memory.shutdown();
if (!configured) throw new Error("Missing store configuration");
const configuration = configured;

let available = true;
let noScript = false;
const commands: Array<[string, ...string[]]> = [];
const call = jest.fn(async (command: string, ...args: string[]) => {
  commands.push([command, ...args]);
  if (!available) throw Object.assign(new Error("fixture outage"), { command: { args: ["private-fixture-secret"] } });
  if (command === "SCRIPT") return "fixture-sha";
  if (command === "EVALSHA") {
    if (noScript) { noScript = false; throw new Error("NOSCRIPT fixture restart"); }
    return [1, 60000];
  }
  return 0;
});
const logger = { error: jest.fn() };
const ready = jest.fn(async () => {});
jest.unstable_mockModule("@/lib/redis.js", () => ({ redis: { call }, redisReady: ready }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger }));
const { RecoverableRateLimitStore } = await import("../../src/lib/rate-limit-store");

beforeEach(() => { available = true; noScript = false; commands.length = 0; jest.clearAllMocks(); });

test("initial SCRIPT LOAD waits for connection readiness and observes timeout before sending commands", async () => {
  let becomeReady: (() => void) | undefined;
  ready.mockImplementationOnce(() => new Promise<void>((resolve) => { becomeReady = resolve; }));
  const store = new RecoverableRateLimitStore("auth", "rl:test:auth:", false);
  await store.init(configuration);
  const incrementing = store.increment("127.0.0.1");
  await Promise.resolve();
  expect(commands).toHaveLength(0);
  if (!becomeReady) throw new Error("Readiness was not requested");
  becomeReady();
  await expect(incrementing).resolves.toMatchObject({ totalHits: 1 });

  const timedOut = new RecoverableRateLimitStore("auth", "rl:test:timeout:", false);
  await timedOut.init(configuration);
  commands.length = 0;
  ready.mockRejectedValueOnce(new Error("Redis connection readiness timed out"));
  await expect(timedOut.increment("127.0.0.1")).rejects.toMatchObject({ statusCode: 503 });
  expect(commands).toHaveLength(0);
  await expect(timedOut.increment("127.0.0.1")).resolves.toMatchObject({ totalHits: 1 });
});

test("get before the first increment initializes lazy scripts and reads the prefixed key", async () => {
  const store = new RecoverableRateLimitStore("api", "rl:preview-a:api:", true);
  await store.init(configuration);
  expect(commands).toHaveLength(0);
  await expect(store.get("u:user-a")).resolves.toMatchObject({ totalHits: 1 });
  expect(commands.filter(([command]) => command === "SCRIPT")).toHaveLength(2);
  expect(commands.at(-1)).toEqual(["EVALSHA", "fixture-sha", "1", "rl:preview-a:api:u:user-a"]);
});

test("real RedisStore sends environment-prefixed user keys and recovers missing scripts", async () => {
  const store = new RecoverableRateLimitStore("api", "rl:preview-a:api:", true);
  await store.init(configuration);
  expect(commands).toHaveLength(0); // Unused policies do not load scripts at cold start.
  noScript = true;
  await expect(store.increment("u:user-a")).resolves.toMatchObject({ totalHits: 1 });
  expect(commands.filter(([command]) => command === "SCRIPT")).toHaveLength(3);
  expect(commands.filter(([command]) => command === "EVALSHA").every((command) => command[3] === "rl:preview-a:api:u:user-a")).toBe(true);
  await store.decrement("u:user-a");
  expect(commands.at(-1)).toEqual(["DECR", "rl:preview-a:api:u:user-a"]);
});

test("failed cold-start SCRIPT LOAD can reinitialize once for concurrent requests after recovery", async () => {
  available = false;
  const store = new RecoverableRateLimitStore("auth", "rl:test:auth:", false);
  await expect(store.init(configuration)).resolves.toBeUndefined();
  await expect(store.increment("127.0.0.1")).rejects.toMatchObject({ statusCode: 503, code: "RATE_LIMIT_STORE_UNAVAILABLE" });
  available = true;
  commands.length = 0;
  await expect(Promise.all([store.increment("127.0.0.1"), store.increment("127.0.0.2")])).resolves.toHaveLength(2);
  expect(commands.filter(([command]) => command === "SCRIPT")).toHaveLength(2);
  expect(commands.filter(([command]) => command === "EVALSHA")).toHaveLength(2);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private-fixture-secret");
});

test("failed successful-login decrement is observed, logged, and conservatively retains the hit", async () => {
  const store = new RecoverableRateLimitStore("auth", "rl:test:auth:", false);
  await store.init(configuration);
  available = false;
  await expect(store.decrement("127.0.0.1")).resolves.toBeUndefined();
  expect(logger.error).toHaveBeenCalledWith({ limiter: "auth", operation: "decrement", failOpen: false }, expect.any(String));
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private-fixture-secret");
});
