import crypto from "node:crypto";
import pinoHttp, { stdSerializers } from "pino-http";

import { logger } from "@/lib/logger";

export const requestLogger = pinoHttp({
  logger,

  // Allow only request metadata; URLs, headers and bodies can contain secrets.
  serializers: {
    req: (req: ReturnType<typeof stdSerializers.req>) => ({
      id: req.id,
      method: req.method,
      url: req.url?.split(/[?#]/, 1)[0],
      remoteAddress: req.remoteAddress,
    }),
    res: (res: ReturnType<typeof stdSerializers.res>) => ({
      statusCode: res.statusCode,
    }),
  },

  genReqId: (_req, res) => {
    const requestId = crypto.randomUUID();
    res.setHeader("X-Request-Id", requestId);
    return requestId;
  },

  customLogLevel: (_req, res, error) => {
    if (error || res.statusCode >= 500) {
      return "error";
    }

    if (res.statusCode >= 400) {
      return "warn";
    }

    return "info";
  },

  customSuccessMessage: (req, res) => {
    return `${req.method} request completed (${res.statusCode})`;
  },

  customErrorMessage: (req, res) => {
    return `${req.method} request failed (${res.statusCode})`;
  },
});
