import { CreatePermissionSchema } from "./permission.schema";
import { permissionService } from "./permission.service";
import { sendResponse } from "@/utils/sendResponse";
import { NextFunction, Request, Response } from "express";

export const permissionController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Grantable permissions fetched successfully",
        await permissionService.listGrantable(),
      );
    } catch (error) {
      next(error);
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = req.validated.body as CreatePermissionSchema;
      const permission = await permissionService.create(validated);
      sendResponse(res, 201, "Permission created successfully", permission);
    } catch (e) {
      next(e);
    }
  },
};
