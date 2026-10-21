import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";

const client = Object.assign(new EventEmitter(), { status: "connecting" });
const construct = jest.fn();
const logger = { info: jest.fn(), error: jest.fn() };
jest.unstable_mockModule("ioredis", () => ({
  Redis: class {
    constructor(...args: unknown[]) {
      construct(...args);
      return client;
    }
  },
}));
const url = "rediss://default:private-sample-password@sample.upstash.io:6379";
jest.unstable_mockModule("@/config/env.js", () => ({ env: {
  REDIS_URL: url,
  REDIS_CONNECT_TIMEOUT_MS: 2000,
  REDIS_COMMAND_TIMEOUT_MS: 2000,
  REDIS_MAX_RETRIES_PER_REQUEST: 1,
} }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger }));
const { redis, redisReady } = await import("@/lib/redis.js");
beforeEach(() => { client.status = "connecting"; });
afterEach(() => { jest.useRealTimers(); });

test("shares the configured TCP client and only logs success after Redis is ready", () => {
  expect(redis).toBe(client);
  expect(construct).toHaveBeenCalledWith(url, {
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.emit("connect");
  expect(logger.info).not.toHaveBeenCalled();
  client.emit("ready");
  expect(logger.info).toHaveBeenCalledWith("Redis ready");
});

test("reuses the warm runtime client without registering duplicate listeners", async () => {
  jest.resetModules();
  const reloaded = await import("@/lib/redis.js");
  expect(reloaded.redis).toBe(redis);
  expect(construct).toHaveBeenCalledTimes(1);
  expect(client.listenerCount("ready")).toBe(1);
  expect(client.listenerCount("error")).toBe(1);
});

test("does not log AUTH command arguments on connection failure", () => {
  const error = Object.assign(new Error("WRONGPASS invalid username-password pair"), {
    command: { name: "auth", args: ["default", "private-sample-password"] },
  });
  client.emit("error", error);
  expect(logger.error).toHaveBeenCalledWith({ message: error.message }, "Redis connection error");
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private-sample-password");
});

test("cold callers and module reloads share one bounded wait until the client becomes ready", async () => {
  const first = redisReady();
  jest.resetModules();
  const reloaded = await import("@/lib/redis.js");
  expect(reloaded.redisReady()).toBe(first);
  expect(client.listenerCount("ready")).toBe(2);
  expect(client.listenerCount("error")).toBe(2);
  expect(client.listenerCount("end")).toBe(1);
  client.status = "ready";
  client.emit("ready");
  await expect(first).resolves.toBeUndefined();
  expect(client.listenerCount("ready")).toBe(1);
  expect(client.listenerCount("error")).toBe(1);
  expect(client.listenerCount("end")).toBe(0);
  await expect(redisReady()).resolves.toBeUndefined();
});

test("readiness timeout removes listeners and permits a later healthy retry", async () => {
  jest.useFakeTimers();
  const waiting = redisReady();
  const rejected = expect(waiting).rejects.toThrow("Redis connection readiness timed out");
  await jest.advanceTimersByTimeAsync(2000);
  await rejected;
  expect(client.listenerCount("ready")).toBe(1);
  expect(client.listenerCount("error")).toBe(1);
  expect(client.listenerCount("end")).toBe(0);
  const retry = redisReady();
  expect(retry).not.toBe(waiting);
  client.status = "ready";
  client.emit("ready");
  await expect(retry).resolves.toBeUndefined();
  expect(jest.getTimerCount()).toBe(0);
});

test("connection errors and shutdown reject cleanly without propagating AUTH arguments", async () => {
  const failed = expect(redisReady()).rejects.toThrow("Redis connection failed before becoming ready");
  client.emit("error", Object.assign(new Error("fixture error"), { command: { args: ["private-fixture-secret"] } }));
  await failed;
  expect(client.listenerCount("end")).toBe(0);
  const closed = expect(redisReady()).rejects.toThrow("Redis connection closed before becoming ready");
  client.status = "end";
  client.emit("end");
  await closed;
  expect(client.listenerCount("ready")).toBe(1);
  expect(client.listenerCount("error")).toBe(1);
  await expect(redisReady()).rejects.toThrow("Redis connection is closed");
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private-fixture-secret");
});
