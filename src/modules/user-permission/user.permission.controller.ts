import { userPermissionService } from "./user.permission.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { NextFunction, Request, Response } from "express";
import type { UserPermissionUpdate } from "./user.permission.schema.js";

export const userPermissionController = {
  async getById(req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "User permissions fetched successfully", await userPermissionService.getById(req.params.userId as string)); }
    catch (error) { next(error); }
  },
  async updatePermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.validated.body as UserPermissionUpdate;
      sendResponse(res, 200, "User permissions updated successfully", await userPermissionService.updateUserPermissions(req.params.userId as string, input));
    } catch (error) { next(error); }
  },
  async assignRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { roleId } = req.validated.body as { roleId: string };
      sendResponse(res, 200, "User role updated successfully", await userPermissionService.assignRole(req.params.id as string, roleId));
    } catch (error) { next(error); }
  },
  async systemAdminUpdatePermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.validated.body as UserPermissionUpdate;
      sendResponse(res, 200, "User permissions updated successfully", await userPermissionService.systemAdminUpdatePermission(req.params.userId as string, input));
    } catch (error) { next(error); }
  },
};
