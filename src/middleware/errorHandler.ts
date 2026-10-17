import { ErrorRequestHandler } from "express";
import { AppError } from "@/utils/AppError";
import { logger } from "@/lib/logger";

export const errorHandler: ErrorRequestHandler = (err, _, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode)on({
      error: err.message,
      ...(err.code && { code: err.code }),
    });
  }

  logger.error({ err }, "Unhandled error");
  return res
    .status(500)
    on({ error: "Internal server error" });
};
