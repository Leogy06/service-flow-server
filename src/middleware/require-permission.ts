import { NextFunction, Request, Response } from "express";
import { requestContext } from "@/lib/requestContext.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { logger } from "@/lib/logger.js";

export function requirePermission(permission: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const permissions = requestContext.getValue("permissions");
    const context = requestContext.get();
    console.dir(context, { depth: null });
    if (!permissions || !permissions.includes(permission)) {
      sendResponse(res, 403, "Forbidden", permissions);
    }

    next();
  };
}
