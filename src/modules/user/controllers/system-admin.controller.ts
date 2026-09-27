import { sendResponse } from "@/utils/sendResponse";
import { SystemAdminCreateInput } from "../schemas/system-admin.schema";
import { systemAdminService } from "../services/system-admin.service";
import { Request, Response, NextFunction } from "express";

export const systemAdminController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = req.validated.body as SystemAdminCreateInput;
      const response = await systemAdminService.create(validated);

      sendResponse(res, 201, "User created successfully", response);
    } catch (e) {
      next(e);
    }
  },
};
