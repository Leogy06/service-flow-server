import { NextFunction, Request, Response } from "express";
import { sendResponse } from "@/utils/sendResponse.js";
import { permissionService } from "@/services/permission.service.js";

export const permissionController = {
  permissions: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const permissions = await permissionService.rolePermissions(
        req.params.roleId as string,
      );
      sendResponse(res, 200, "Permissions fetched successfully", permissions);
    } catch (err) {
      next(err);
    }
  },
};
