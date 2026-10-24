import { jest } from "@jest/globals";
import type { Server } from "node:http";
import { createShutdown } from "../../src/lib/shutdown.js";

afterEach(() => jest.useRealTimers());

test("shutdown drains once before closing resources and completing successfully", async () => {
  let closed: ((error?: Error) => void) | undefined;
  const server = { close: jest.fn((callback: (error?: Error) => void) => { closed = callback; }), closeAllConnections: jest.fn() };
  const cleanup = jest.fn(async () => {});
  const finish = jest.fn();
  const shutdown = createShutdown(server as unknown as Server, cleanup, finish, { info: jest.fn(), error: jest.fn() });
  const pending = shutdown("SIGTERM");
  expect(shutdown("SIGINT")).toBe(pending);
  expect(cleanup).not.toHaveBeenCalled();
  closed!();
  await pending;
  expect(server.close).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledWith(0);
});

test.each(["drain", "cleanup"])("a stuck %s ends at the deadline and exits unsuccessfully", async stage => {
  jest.useFakeTimers();
  const server = { close: jest.fn((callback: () => void) => { if (stage === "cleanup") callback(); }), closeAllConnections: jest.fn() };
  const finish = jest.fn();
  const shutdown = createShutdown(server as unknown as Server, () => new Promise<void>(() => {}), finish, { info: jest.fn(), error: jest.fn() }, 100);
  const pending = shutdown("SIGTERM");
  await jest.advanceTimersByTimeAsync(100);
  await pending;
  expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
  expect(finish).toHaveBeenCalledWith(1);
});

test("resource cleanup failure is reported without logging exception secrets", async () => {
  const server = { close: (callback: () => void) => { callback(); }, closeAllConnections: jest.fn() };
  const finish = jest.fn();
  const log = { info: jest.fn(), error: jest.fn() };
  const shutdown = createShutdown(server as unknown as Server, async () => { throw new Error("private database URL"); }, finish, log);
  await shutdown("SIGTERM");
  expect(finish).toHaveBeenCalledWith(1);
  expect(JSON.stringify(log.error.mock.calls)).not.toContain("private database URL");
});
