import { roleService } from "./role.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { NextFunction, Response, Request } from "express";
import type { CreateRoleSchema, UpdateRoleSchema } from "./role.schema.js";

export const roleController = {
  async listAssignable(_req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "Assignable roles fetched successfully", await roleService.listAssignable()); }
    catch (error) { next(error); }
  },
  async list(_req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "Roles fetched successfully", await roleService.list()); }
    catch (error) { next(error); }
  },
  async getById(req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "Role fetched successfully", await roleService.getById(req.params.id as string)); }
    catch (error) { next(error); }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 201, "Role created successfully", await roleService.create(req.validated.body as CreateRoleSchema)); }
    catch (error) { next(error); }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "Role updated successfully", await roleService.update(req.params.id as string, req.validated.body as UpdateRoleSchema)); }
    catch (error) { next(error); }
  },
  async delete(req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "Role deleted successfully", await roleService.delete(req.params.id as string)); }
    catch (error) { next(error); }
  },
};
