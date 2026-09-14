import { requestContext } from "@/lib/requestContext.js";
import { roleService } from "@/services/role.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { NextFunction, Response, Request } from "express";

export const roleController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = requestContext.getValue(
        "organizationId",
      ) as string;
      const roles = await roleService.list(organizationId);
      sendResponse(res, 200, "OK", roles);
    } catch (err) {
      next(err);
    }
  },
};
