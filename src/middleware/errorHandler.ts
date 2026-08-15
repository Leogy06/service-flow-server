import { ErrorRequestHandler } from "express";
import { AppError } from "@/utils/AppError.js";
import { logger } from "@/lib/logger.js";

export const errorHandler: ErrorRequestHandler = (err, _, res, __) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: "Internal server error" });
};
