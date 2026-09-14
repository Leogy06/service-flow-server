import { NextFunction, Request, Response } from "express";
import { sendResponse } from "@/utils/sendResponse.js";
import { rolePermissionService } from "./role.permission.service.js";
import { UpdateRolePermissionSchema } from "./role.permission.schema.js";
import { requestContext } from "@/lib/requestContext.js";

type CreatePermissionInput = {
  roleId: string;
  permissionId: string;
};

export const rolePermissionController = {
  list: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const permissions = await rolePermissionService.list(
        req.params.roleId as string,
      );
      sendResponse(res, 200, "Permissions fetched successfully", permissions);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = req.validated.body as CreatePermissionInput;
      const permission = await rolePermissionService.create(validated);
      sendResponse(res, 201, "Permission created successfully", permission);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    const organizationId = requestContext.getValue("organizationId") as string;

    try {
      const validated = req.validated.body as UpdateRolePermissionSchema;
      const permissions = await rolePermissionService.update(
        req.params.roleId as string, // role
        validated.permissions, // permissions
        organizationId, // organization
      );

      sendResponse(res, 200, "Permissions updated successfully", permissions);
    } catch (err) {
      next(err);
    }
  },
};
