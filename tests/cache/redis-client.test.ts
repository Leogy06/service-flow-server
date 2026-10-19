import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";

const client = new EventEmitter();
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
jest.unstable_mockModule("@/config/env.js", () => ({ env: { REDIS_URL: url } }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger }));
const { redis } = await import("@/lib/redis.js");

test("shares the configured TCP client and only logs success after Redis is ready", () => {
  expect(redis).toBe(client);
  expect(construct).toHaveBeenCalledWith(url, { maxRetriesPerRequest: 3 });
  client.emit("connect");
  expect(logger.info).not.toHaveBeenCalled();
  client.emit("ready");
  expect(logger.info).toHaveBeenCalledWith("Redis ready");
});

test("does not log AUTH command arguments on connection failure", () => {
  const error = Object.assign(new Error("WRONGPASS invalid username-password pair"), {
    command: { name: "auth", args: ["default", "private-sample-password"] },
  });
  client.emit("error", error);
  expect(logger.error).toHaveBeenCalledWith({ message: error.message }, "Redis connection error");
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private-sample-password");
});
