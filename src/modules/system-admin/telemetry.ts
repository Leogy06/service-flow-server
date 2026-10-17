import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "@/lib/logger";
type Bucket = {
  minute: number;
  count: number;
  errors: number;
  elapsed: number;
  samples: number[];
};
const buckets = new Map<number, Bucket>();
const recentErrors: Array<{ at: string; status: number; requestId: string }> =
  [];
const instanceId = randomUUID();
const startedAt = new Date().toISOString();
let errorHandler: ((instance: string) => Promise<unknown>) | undefined;
let lastErrorAlertMinute = -1;
export function onPlatformServerError(
  handler: (instance: string) => Promise<unknown>,
) {
  errorHandler = handler;
}

export const observeRequests: RequestHandler = (req, res, next) => {
  const start = performance.now();
  res.once("finish", () => {
    const minute = Math.floor(Date.now() / 60000);
    for (const key of buckets.keys())
      if (key < minute - 59) buckets.delete(key);
    const b = buckets.get(minute) ?? {
      minute,
      count: 0,
      errors: 0,
      elapsed: 0,
      samples: [],
    };
    const elapsed = performance.now() - start;
    b.count++;
    b.elapsed += elapsed;
    if (b.samples.length < 256) b.samples.push(elapsed);
    if (res.statusCode >= 500) {
      b.errors++;
      recentErrors.unshift({
        at: new Date().toISOString(),
        status: res.statusCode,
        requestId: String(req.id ?? "").slice(0, 100),
      });
      if (recentErrors.length > 50) recentErrors.pop();
      if (errorHandler && minute !== lastErrorAlertMinute) {
        lastErrorAlertMinute = minute;
        void errorHandler(instanceId).catch(() =>
          logger.error(
            "Unable to persist the platform error alert; inspect server logs",
          ),
        );
      }
    }
    buckets.set(minute, b);
  });
  next();
};

export function trafficSnapshot() {
  const minute = Math.floor(Date.now() / 60000);
  const rows = [...buckets.values()].filter((b) => b.minute >= minute - 59);
  const requestCount = rows.reduce((n, b) => n + b.count, 0);
  const samples = rows.flatMap((b) => b.samples).sort((a, b) => a - b);
  return {
    windowMinutes: 60,
    instanceId,
    startedAt,
    requestCount,
    errorCount: rows.reduce((n, b) => n + b.errors, 0),
    averageLatencyMs: requestCount
      ? Math.round(
          (rows.reduce((n, b) => n + b.elapsed, 0) / requestCount) * 100,
        ) / 100
      : null,
    p95LatencyMs: samples.length
      ? Math.round(samples[Math.ceil(samples.length * 0.95) - 1] * 100) / 100
      : null,
    latencySampleCount: samples.length,
    recentErrors: recentErrors.filter(
      (e) => Date.parse(e.at) >= Date.now() - 3600000,
    ),
  };
}
