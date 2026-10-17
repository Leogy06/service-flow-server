import type { NextFunction, Request, Response } from "express";
import { sendResponse } from "@/utils/sendResponse";
import { auditService } from "./audit.service";
import type { ListAuditLogsQuery } from "./audit.schema";

export const auditController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await auditService.list(
        req.validated.query as ListAuditLogsQuery,
      );
      res.setHeader("Cache-Control", "private, no-store");
      sendResponse(res, 200, "Audit logs fetched successfully", data);
    } catch (error) {
      next(error);
    }
  },
};
