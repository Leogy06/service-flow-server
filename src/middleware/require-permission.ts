import { NextFunction, Request, Response } from "express";
import { requestContext } from "@/lib/requestContext.js";
import { sendResponse } from "@/utils/sendResponse.js";

export function requirePermission(permission: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const permissions = requestContext.getValue("permissions");
    if (!permissions || !permissions.includes(permission)) {
      sendResponse(res, 403, "Forbidden", null);
      return; //necessary do not remove to stop
    }

    next();
  };
}
