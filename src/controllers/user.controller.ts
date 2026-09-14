import { Request, Response, NextFunction } from "express";
// import { z } from "zod";
import { userService } from "@/services/user.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { requestContext } from "@/lib/requestContext.js";
import { Prisma } from "@/generated/prisma/client.js";
import {
  CreateUserInviteSchema,
  CreateUserSchema,
} from "@/schemas/user.schema.js";

export const userController = {
  async list(req: Request, res: Response, next: NextFunction) {
    const organizationId = requestContext.getValue("organizationId") as string;
    const select = req.query.select as Prisma.UserSelect;

    try {
      const users = await userService.list({
        organizationId,
        select,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 10,
        search: req.query.search as string,
        sortOrder: req.query.sortOrder as "asc" | "desc",
        sortBy: req.query.sortBy as string,
      });
      sendResponse(res, 200, "Users fetched successfully", users);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.getById(req.params.id as string);
      sendResponse(res, 200, "OK", user);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = req.body;
      const user = await userService.update(req.params.id as string, parsed);
      sendResponse(res, 200, "User updated successfully", user);
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.delete(req.params.id as string);
      sendResponse(res, 200, "User deleted successfully", user);
    } catch (err) {
      next(err);
    }
  },

  async restore(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.restore(req.params.id as string);
      sendResponse(res, 200, "User restored successfully", user);
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = req.validated.body as CreateUserSchema;

      const organizationId = requestContext.getValue(
        "organizationId",
      ) as string;

      const user = await userService.createDirect({
        ...validated,
        organizationId,
      });

      sendResponse(res, 201, "User created successfully", user);
    } catch (err) {
      next(err);
    }
  },

  async createWithInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = requestContext.getValue(
        "organizationId",
      ) as string;
      const validated = req.validated.body as CreateUserInviteSchema;
      const response = await userService.createWithInvite({
        ...validated,
        organizationId,
      });
      sendResponse(res, 201, "User created successfully", response);
    } catch (err) {
      next(err);
    }
  },

  async setPassword(req:Request,res:Response,next:NextFunction){
    try {
      const organizationId = requestContext.getValue(
        "organizationId",
      ) as string;
      const response = await userService.setPassword({
        ...req.body,
        organizationId,
      });
      sendResponse(res, 200, "User created successfully", response);
    } catch (err) {
      next(err);
    }
  }

  async listForPermissionManagement(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const organizationId = requestContext.getValue(
        "organizationId",
      ) as string;
      const users =
        await userService.listForPermissionManagement(organizationId);
      sendResponse(res, 200, "Users fetched successfully", users);
    } catch (e) {
      console.dir(e);
      next(e);
    }
  },
};
