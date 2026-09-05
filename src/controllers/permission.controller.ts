import { NextFunction, Request, Response } from "express";
import { sendResponse } from "@/utils/sendResponse.js";
import { permissionService } from "@/services/permission.service.js";


type CreatePermissionInput = {
  roleId: string;
  permissionId: string;
}

export const permissionController = {
  list: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const permissions = await permissionService.list(
        req.params.roleId as string,
      );
      sendResponse(res, 200, "Permissions fetched successfully", permissions);
    } catch (err) {
      next(err);
    }
  },

  create:async(req:Request, res:Response, next:NextFunction) => {
    try {
      const validated = req.validated.body as CreatePermissionInput;
      const permission = await permissionService.create(validated);
      sendResponse(res, 201, "Permission created successfully", permission);
    } catch (err) {
      next(err);
    }
  }
};
