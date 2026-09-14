import { userPermissionService } from "./user.permission.service.js";
import { AppError } from "@/utils/AppError.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { NextFunction, Request, Response } from "express";

export const userPermissionController = {
  async updatePermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params as { userId: string };
      const { permissionIds } = req.validated.body as {
        permissionIds: string[];
      };

      if (!req.user) throw new AppError(401, "Unauthorized");

      const permissions = await userPermissionService.updateUserPermissions(
        userId,
        permissionIds,
        req.user.organizationId,
      );

      sendResponse(
        res,
        200,
        "User permissions updated successfully",
        permissions,
      );
    } catch (e) {
      next(e);
    }
  },
};
