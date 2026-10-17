import { roleService } from "./role.service";
import { sendResponse } from "@/utils/sendResponse";
import { NextFunction, Response, Request } from "express";
import type {
  CreateRoleSchema,
  UpdateRoleSchema,
  ListRolesQuery,
  RestoreRoleInput,
} from "./role.schema";

export const roleController = {
  async listAssignable(_req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Assignable roles fetched successfully",
        await roleService.listAssignable(),
      );
    } catch (error) {
      next(error);
    }
  },
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Roles fetched successfully",
        await roleService.list(req.validated.query as ListRolesQuery),
      );
    } catch (error) {
      next(error);
    }
  },
  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Role fetched successfully",
        await roleService.getById(req.params.id as string),
      );
    } catch (error) {
      next(error);
    }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        201,
        "Role created successfully",
        await roleService.create(req.validated.body as CreateRoleSchema),
      );
    } catch (error) {
      next(error);
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Role updated successfully",
        await roleService.update(
          req.params.id as string,
          req.validated.body as UpdateRoleSchema,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Role archived successfully",
        await roleService.delete(req.params.id as string),
      );
    } catch (error) {
      next(error);
    }
  },
  async restore(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Role restored successfully",
        await roleService.restore(
          req.params.id as string,
          req.validated.body as RestoreRoleInput,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
};
