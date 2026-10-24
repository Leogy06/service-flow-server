import { Router } from "express";
import { authenticate } from "@/middleware/auth";
import { requireSystemAdmin } from "@/middleware/require-platform-admin";
import { apiLimiter, publicApiLimiter } from "@/middleware/rateLimiter";
import { validate } from "@/middleware/validate";
import { matchesSecret } from "@/middleware/access-logger";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";
import { sendResponse } from "@/utils/sendResponse";
import { accessLogQuery, type AccessLogQuery } from "./access-logs.schema";
import { listAccessLogs, topAccessIps, pruneAccessLogs } from "./access-logs.service";

export const accessLogRoutes = Router();
accessLogRoutes.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
accessLogRoutes.use(authenticate, apiLimiter, requireSystemAdmin);
accessLogRoutes.get("/top-ips", async (_req, res) => {
  sendResponse(res, 200, "Top IPs fetched", await topAccessIps());
});
accessLogRoutes.get("/", validate(accessLogQuery), async (req, res) => {
  sendResponse(res, 200, "Access logs fetched", await listAccessLogs(req.validated.query as AccessLogQuery));
});

export const accessLogCronRoutes = Router();
accessLogCronRoutes.use(publicApiLimiter);
accessLogCronRoutes.get("/access-logs", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!matchesSecret(req.get("authorization"), env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : undefined)) {
    throw new AppError(401, "Unauthorized");
  }
  sendResponse(res, 200, "Expired access logs deleted", await pruneAccessLogs());
});
