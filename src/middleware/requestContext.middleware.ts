import { requestContext } from "@/lib/requestContext.js";
import { NextFunction, Request, Response } from "express";
import crypto from "crypto";
export function withRequestContext(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", requestId);

  requestContext.run(
    {
      requestId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      organizationId: req.user?.organizationId,
      // userId/userEmail get filled in later once requireAuth runs
    },
    next,
  );
}
