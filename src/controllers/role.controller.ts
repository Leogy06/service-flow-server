import { roleService } from "@/services/role.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { NextFunction, Response, Request } from "express";

export const roleController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const roles = await roleService.list(req.params.id as string);
      sendResponse(res, 200, "OK", roles);
    } catch (err) {
      next(err);
    }
  },
};
