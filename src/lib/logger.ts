import pino from "pino";
import { env } from "@/config/env";

const isTest = env.NODE_ENV === "test";
const isProduction = env.NODE_ENV === "production";

export const logger = pino(
  isTest
    ? {
        level: "silent",
      }
    : isProduction
      ? {
          level: env.LOG_LEVEL || "info",

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

          transport: {
            target: "pino-roll",
            options: {
              file: "logs/app.log",
              frequency: "daily",
              mkdir: true,
            },
          },
        }
      : {
          level: env.LOG_LEVEL || "debug",

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
