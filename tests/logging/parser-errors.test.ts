import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import pino from "pino";
import { Writable } from "node:stream";

let output = "";
const logger = pino({}, new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger }));
const { errorHandler } = await import("@/middleware/errorHandler.js");
const { requestLogger } = await import("@/middleware/request-logger.js");
const app = express();
app.use(requestLogger, express.json({ limit: 128 }));
app.post("/login", (_req, res) => res.sendStatus(200));
app.get("/unexpected", () => { throw new Error("Unexpected failure"); });
app.use(errorHandler);
beforeEach(() => { output = ""; });

test("malformed credential JSON is a safe 400 and neither logger retains its body or parse excerpt", async () => {
  const response = await request(app).post("/login").type("json").send('{"password":"synthetic-private-password", invalid}');
  expect(response.status).toBe(400);
  expect(response.body).toEqual({ error: "Invalid JSON request body" });
  expect(output).not.toContain("synthetic-private-password");
  expect(output).not.toContain("invalid}");
});

test("oversized and unsupported encoded bodies return safe client errors", async () => {
  const oversized = await request(app).post("/login").send({ password: "synthetic-secret-".repeat(30) });
  expect(oversized.status).toBe(413);
  const unsupported = await request(app).post("/login").set("Content-Type", "application/json; charset=iso-8859-1").send('{"password":"encoding-secret"}');
  expect(unsupported.status).toBe(415);
  expect(output).not.toContain("synthetic-secret-");
  expect(output).not.toContain("encoding-secret");
});

test("unexpected application errors retain diagnostics with a generic 500 response", async () => {
  const response = await request(app).get("/unexpected");
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: "Internal server error" });
  expect(output).toContain("Unexpected failure");
});
