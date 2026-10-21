import { ErrorRequestHandler } from "express";
import { AppError } from "@/utils/AppError";
import { logger } from "@/lib/logger";

export const errorHandler: ErrorRequestHandler = (err, _, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.code && { code: err.code }),
      ...(err.retryAfterSeconds !== undefined && { retryAfterSeconds: err.retryAfterSeconds }),
    });
  }

  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: "Internal server error" });
};
