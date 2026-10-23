import pino from "pino";
import { env } from "@/config/env";

const isTest = env.NODE_ENV === "test";
const isProduction = env.NODE_ENV === "production";
// Vercel's deployed filesystem is read-only; its platform captures stdout.
const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const sensitiveRedaction = {
  paths: ["req.headers.authorization", "req.headers.cookie", "res.headers[\"set-cookie\"]", "req.body.password",
    "req.body.currentPassword", "req.body.newPassword", "req.body.confirmPassword", "req.body.token",
    "req.body.accessToken", "req.body.refreshToken", "req.body.code", "req.body.challengeId"],
  censor: "[REDACTED]",
};

export const logger = pino(
  isTest
    ? {
        level: "silent",
      }
    : isProduction
      ? {
          level: env.LOG_LEVEL || "info",

          timestamp: pino.stdTimeFunctions.isoTime,

          redact: sensitiveRedaction,

          ...(!isVercel && { transport: {
            targets: [
              { target: "pino/file", options: { destination: 1 } },
              {
                target: "pino-roll",
                options: {
                  file: "logs/app.log",
                  extension: ".log",
                  frequency: "daily",
                  dateFormat: "yyyy-MM-dd",
                  size: "10m",
                  mkdir: true,
                  limit: {
                    count: env.LOG_MAX_FILES,
                    // Include this instance's logs from previous runs in retention.
                    removeOtherLogFiles: true,
                  },
                },
              },
            ],
          } }),
        }
      : {
          level: env.LOG_LEVEL || "debug",
          redact: sensitiveRedaction,

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
