import { jest } from "@jest/globals";
import { envSchema } from "../../src/config/env-schema";
import { databaseEnvironmentSchema, databaseOptions } from "../../src/config/database";

const config = jest.fn();
jest.unstable_mockModule("dotenv", () => ({ config }));
const { loadEnvironment } = await import("../../src/config/env-file");

const development = {
  DATABASE_URL: "mysql://root:p%40ss%23word@127.0.0.1:3307/service_flow_dev?connection_limit=5",
  REDIS_URL: "redis://127.0.0.1:6379",
  CORS_ORIGIN: "http://localhost:3000",
  JWT_ACCESS_SECRET: "sample-access-secret",
  JWT_REFRESH_SECRET: "sample-refresh-secret",
  RESEND_API_KEY: "sample-email-key",
  EMAIL_FROM: "Sample <sample@example.com>",
};
const production = {
  ...development,
  NODE_ENV: "production",
  DATABASE_URL: "mysql://user:sample@database.example.com:3306/service_flow?connection_limit=5&sslaccept=strict",
  REDIS_URL: "rediss://default:sample@sample.upstash.io:6379",
  CORS_ORIGIN: "https://app.example.com",
};

test("defaults to development without separate DATABASE_* inputs and derives logging defaults", () => {
  expect(envSchema.parse(development)).toMatchObject({ NODE_ENV: "development", PORT: 4000, LOG_LEVEL: "debug" });
  expect(envSchema.parse(production).LOG_LEVEL).toBe("info");
  expect(envSchema.parse({ ...production, LOG_LEVEL: "warn" }).LOG_LEVEL).toBe("warn");
});

test.each(["localhost", "LOCALHOST.", "127.0.0.1", "127.2.3.4", "[::1]", "0.0.0.0"])("rejects production loopback database %s", (host) => {
  expect(envSchema.safeParse({ ...production, DATABASE_URL: `mysql://user:sample@${host}:3306/service_flow` }).success).toBe(false);
});

test.each([
  { DATABASE_URL: "postgresql://user:sample@remote.example.com/db" },
  { DATABASE_URL: "mysql://user:sample@remote.example.com/" },
  { DATABASE_URL: "mysql://user:sample@remote.example.com/db" },
  { DATABASE_URL: "mysql://user:sample@remote.example.com/db?connection_limit=0" },
  { DATABASE_URL: "mysql://user:sample@remote.example.com/db?sslaccept=accept_invalid_certs" },
  { DATABASE_URL: "mysql://user:sample@remote.example.com/db?socket=/run/mysqld.sock" },
  { REDIS_URL: "redis://remote.example.com:6379" },
  { REDIS_URL: "https://sample.upstash.io" },
  { CORS_ORIGIN: "http://app.example.com" },
  { PORT: "65536" },
  { SALT_ROUNDS: "0" },
])("rejects invalid production configuration: %j", (override) => {
  expect(envSchema.safeParse({ ...production, ...override }).success).toBe(false);
});

test("reports all missing keys without including credential values", () => {
  const result = envSchema.safeParse({ DATABASE_URL: "https://user:private-test-password@remote.example.com/db" });
  expect(result.success).toBe(false);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path[0]);
    expect(keys).toEqual(expect.arrayContaining(["DATABASE_URL", "REDIS_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "CORS_ORIGIN", "RESEND_API_KEY", "EMAIL_FROM"]));
    expect(JSON.stringify(result.error.issues)).not.toContain("private-test-password");
  }
});

test("Prisma CLI validates database configuration without unrelated application secrets", () => {
  expect(databaseEnvironmentSchema.parse({ DATABASE_URL: development.DATABASE_URL })).toMatchObject({ NODE_ENV: "development" });
});

test("adapter decodes URL credentials and uses the URL pool limit and verified production TLS", () => {
  expect(databaseOptions({ ...development, NODE_ENV: "development" })).toMatchObject({
    host: "127.0.0.1", port: 3307, user: "root", password: "p@ss#word", database: "service_flow_dev", connectionLimit: 5,
  });
  expect(databaseOptions(production)).toMatchObject({ ssl: { rejectUnauthorized: true }, allowPublicKeyRetrieval: false });
  expect(databaseOptions({ ...development, NODE_ENV: "development" }).ssl).toBeUndefined();
});

test.each([undefined, "development", "production", "test"])("loads the correct file with injected-variable priority for %s", (mode) => {
  const original = process.env.NODE_ENV;
  try {
    if (mode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = mode;
    config.mockClear();
    loadEnvironment();
    expect(config).toHaveBeenCalledWith({
      path: expect.stringMatching(mode === "production" ? /\.env\.production$/ : /\.env\.development$/),
      override: false, quiet: true,
    });
    expect(process.env.NODE_ENV).toBe(mode ?? "development");
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
