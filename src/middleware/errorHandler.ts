import { ErrorRequestHandler } from "express";
import { AppError } from "@/utils/AppError";
import { logger } from "@/lib/logger";

export const errorHandler: ErrorRequestHandler = (err, _, res, _next) => {
  // body-parser errors carry the raw body and may quote credentials in their
  // message/stack. Never forward those objects to either structured logger.
  const parserErrors: Record<string, { status: number; message: string }> = {
    "entity.parse.failed": { status: 400, message: "Invalid JSON request body" },
    "entity.too.large": { status: 413, message: "Request body is too large" },
    "charset.unsupported": { status: 415, message: "Unsupported request encoding" },
    "encoding.unsupported": { status: 415, message: "Unsupported request encoding" },
    "request.aborted": { status: 400, message: "Request body was interrupted" },
    "request.size.invalid": { status: 400, message: "Invalid request body size" },
  };
  if (err && typeof err.type === "string" && Object.hasOwn(parserErrors, err.type)) {
    const failure = parserErrors[err.type]!;
    return res.status(failure.status).json({ error: failure.message });
  }
  if (err instanceof AppError) {
    if (err.retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(err.retryAfterSeconds));
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.code && { code: err.code }),
      ...(err.retryAfterSeconds !== undefined && { retryAfterSeconds: err.retryAfterSeconds }),
    });
  }

  logger.error({ err }, "Unhandled error");
  return res.status(500).json({ error: "Internal server error" });
};
