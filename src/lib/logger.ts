import { env } from "@/config/env";
import pino from "pino";

const isTest = env.NODE_ENV === "test";
const isProduction = env.NODE_ENV === "production";

export const logger = pino(
  isTest
    ? {
        level: "silent",
      }
    : isProduction
      ? {
          level: process.env.LOG_LEVEL || "info",

          timestamp: pino.stdTimeFunctions.isoTime,

          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.body.password",
              "req.body.accessToken",
              "req.body.refreshToken",
            ],
            censor: "[REDACTED]",
          },
        }
      : {
          level: env.LOG_LEVEL,

          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:standard",
              ignore: "pid,hostname",
            },
          },
        },
);