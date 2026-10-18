import { jest } from "@jest/globals";
import express from "express";
import cors from "cors";
import pino from "pino";
import request from "supertest";

type LogEntry = {
  level: number;
  req: { id: string; method: string; url: string; remoteAddress: string };
  res: { statusCode: number };
  responseTime: number;
  msg: string;
};
const entries: LogEntry[] = [];
const logger = pino({ level: "trace" }, {
  write: (line: string) => { entries.push(JSON.parse(line) as LogEntry); },
});
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger }));
const { requestLogger } = await import("@/middleware/request-logger.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const app = express();
app.use(requestLogger);
app.use(cors());
app.use(express.json());
app.use(withRequestContext);
app.post("/api/auth/login", (_req, res) => {
  res.cookie("refreshToken", "private-refresh-token", { httpOnly: true });
  res.json({ accessToken: "private-access-token" });
});
app.get("/api/status/:status", (req, res) => { res.sendStatus(Number(req.params.status)); });

beforeEach(() => {
  entries.length = 0;
  logger.level = "trace";
});

test.each([
  [200, 30], [401, 40], [403, 40], [404, 40], [429, 40], [500, 50],
])("records one summary for HTTP %i with the appropriate level", async (status, level) => {
  const response = await request(app).get(`/api/status/${status}`);
  expect(response.status).toBe(status);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    level, req: { method: "GET", url: `/api/status/${status}` },
    res: { statusCode: status }, responseTime: expect.any(Number),
  });
  expect(entries[0].req.id).toBe(response.headers["x-request-id"]);
  expect(entries[0].req.id).toMatch(/^[0-9a-f-]{36}$/);
});

test("omits credentials, headers, query values and bodies from actual JSON logs", async () => {
  const response = await request(app)
    .post("/api/auth/login?token=private-query-token&email=private%40example.invalid")
    .set("Authorization", "Bearer private-bearer-token")
    .set("Cookie", "refreshToken=private-request-cookie")
    .set("X-Api-Key", "private-api-key")
    .set("Referer", "https://example.invalid/reset?token=private-referrer-token")
    .send({ password: "private-password", customerName: "private-customer-name" });
  expect(response.status).toBe(200);
  expect(entries).toHaveLength(1);
  expect(entries[0].req.url).toBe("/api/auth/login");
  expect(Object.keys(entries[0].req).sort()).toEqual(["id", "method", "remoteAddress", "url"]);
  expect(entries[0].res).toEqual({ statusCode: 200 });
  expect(JSON.stringify(entries)).not.toContain("private");
});

test("also omits query values from failed request logs", async () => {
  await request(app).get("/api/status/500?token=private-error-token");
  expect(entries).toHaveLength(1);
  expect(entries[0].level).toBe(50);
  expect(JSON.stringify(entries)).not.toContain("private-error-token");
});

test("logs CORS preflight responses before later middleware runs", async () => {
  const response = await request(app).options("/api/auth/login")
    .set("Origin", "https://example.invalid")
    .set("Access-Control-Request-Method", "POST");
  expect(response.status).toBe(204);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ req: { method: "OPTIONS" }, res: { statusCode: 204 } });
  expect(entries[0].req.id).toBe(response.headers["x-request-id"]);
});

test("records unmatched routes and generates distinct IDs instead of trusting a client ID", async () => {
  const first = await request(app).get("/api/missing").set("X-Request-Id", "client-supplied");
  const second = await request(app).get("/api/missing");
  expect(first.status).toBe(404);
  expect(entries).toHaveLength(2);
  expect(first.headers["x-request-id"]).not.toBe("client-supplied");
  expect(first.headers["x-request-id"]).not.toBe(second.headers["x-request-id"]);
  expect(entries.every((entry) => entry.level === 40)).toBe(true);
});

test("a higher LOG_LEVEL filters successful request summaries", async () => {
  logger.level = "warn";
  await request(app).get("/api/status/200");
  await request(app).get("/api/status/401");
  expect(entries).toHaveLength(1);
  expect(entries[0].res.statusCode).toBe(401);
});
