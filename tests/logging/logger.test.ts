import { jest } from "@jest/globals";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Writable } from "node:stream";
import pino, { type LoggerOptions } from "pino";

const settings = { NODE_ENV: "production", LOG_LEVEL: "info", LOG_MAX_FILES: 2 };
const originalVercel = process.env.VERCEL;
const originalVercelEnv = process.env.VERCEL_ENV;
const createLogger = jest.fn((_options: LoggerOptions) => pino({ level: "silent" }));
Object.assign(createLogger, { stdTimeFunctions: pino.stdTimeFunctions });
jest.unstable_mockModule("pino", () => ({ default: createLogger }));
jest.unstable_mockModule("@/config/env.js", () => ({ env: settings }));

beforeEach(() => {
  jest.resetModules();
  createLogger.mockClear();
  settings.NODE_ENV = "production";
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  if (originalVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = originalVercel;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

async function configuredOptions() {
  await import("@/lib/logger.js");
  return createLogger.mock.calls[0][0];
}

test("bounds matching files across rotations and removes logs from previous runs", async () => {
  const options = await configuredOptions();
  const transport = options.transport;
  if (!transport || !("targets" in transport)) throw new Error("Expected production transports");
  const rolling = transport.targets.find((target) => "target" in target && target.target === "pino-roll");
  if (!rolling?.options) throw new Error("Missing rolling file options");
  expect(rolling.options.limit).toEqual({ count: 2, removeOtherLogFiles: true });

  // Exercise the installed transport in an isolated temporary directory only.
  const tempRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(tempRoot, "service-flow-logging-"));
  if (dirname(directory) !== tempRoot || !basename(directory).startsWith("service-flow-logging-")) {
    throw new Error("Refusing to use an unexpected temporary directory");
  }
  const buildRollingStream = createRequire(import.meta.url)("pino-roll") as
    (options: Record<string, unknown>) => Promise<Writable>;
  let stream: Writable | undefined;
  try {
    for (let number = 1; number <= 4; number++) {
      await writeFile(join(directory, `app.2000-01-01.${number}.log`), "old log\n");
    }
    await writeFile(join(directory, "notes.txt"), "keep notes");
    await writeFile(join(directory, "audit.2000-01-01.1.log"), "keep separate logs");
    stream = await buildRollingStream({ ...rolling.options, file: join(directory, "app.log"), size: "1k" });
    await once(stream, "ready");
    for (let rotation = 0; rotation < 3; rotation++) {
      const cleaned = once(stream, "cleanup-complete");
      const opened = once(stream, "ready");
      stream.write("x".repeat(2048) + "\n");
      await Promise.all([cleaned, opened]);
      const matching = (await readdir(directory)).filter((file) => file.startsWith("app."));
      // Reopening is asynchronous; the active file can be created after cleanup scans.
      expect(matching.length).toBeLessThanOrEqual(settings.LOG_MAX_FILES + 1);
      expect(matching.length).toBeGreaterThanOrEqual(2);
    }
    const logFiles = (await readdir(directory)).filter((file) => file.startsWith("app."));
    expect(logFiles.some((file) => file.startsWith("app.2000-01-01."))).toBe(false);
    expect(await readFile(join(directory, "notes.txt"), "utf8")).toBe("keep notes");
    expect(await readFile(join(directory, "audit.2000-01-01.1.log"), "utf8")).toBe("keep separate logs");
  } finally {
    if (stream) {
      const closed = once(stream, "close");
      stream.end();
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("development uses only the pretty console transport", async () => {
  settings.NODE_ENV = "development";
  expect((await configuredOptions()).transport).toMatchObject({ target: "pino-pretty" });
});

test.each(["VERCEL", "VERCEL_ENV"])("production %s deployments use stdout without filesystem transports", async (key) => {
  process.env[key] = key === "VERCEL" ? "1" : "preview";
  const options = await configuredOptions();
  expect(options.transport).toBeUndefined();
  expect(options.level).toBe("info");
  expect(options.redact).toBeDefined();
});

test("tests are silent and do not open file transports", async () => {
  settings.NODE_ENV = "test";
  expect(await configuredOptions()).toEqual({ level: "silent" });
});
