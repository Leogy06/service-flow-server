import { Request, Response, NextFunction } from "express";
// import { z } from "zod";
import { userService } from "./user.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { requestContext } from "@/lib/requestContext.js";
import {
  CreateUserInviteSchema,
  CreateUserSchema,
  ResetTokenExpirationDateInvitationSchema,
  SetPasswordParams,
  SetPasswordSchema,
  UserListQuery,
} from "./user.schema.js";
import { UserUpdateInput } from "./types.js";

export const userController = {
  async listRoles(_req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = requestContext.getValue("organizationId") as string;
      const roles = await userService.listRoles(organizationId);
      sendResponse(res, 200, "User roles fetched successfully", roles);
    } catch (err) {
      next(err);
    }
  },
  async list(req: Request, res: Response, next: NextFunction) {
    const organizationId = requestContext.getValue("organizationId") as string;

    try {
      const users = await userService.list({
        organizationId,
        ...(req.validated.query as UserListQuery),
      });
      sendResponse(res, 200, "Users fetched successfully", users);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = req.validated.body as UserUpdateInput;
      const authUserOrg = requestContext.getValue("organizationId") as string;
      const user = await userService.update(
        req.params.id as string,
        parsed,
        authUserOrg,
      );
      sendResponse(res, 200, "User updated successfully", user);
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const organizationId = requestContext.getValue(
        "organizationId",
      ) as string;

      const actorId = requestContext.getValue("userId") as string;

      const user = await userService.delete(
        req.params.id as string,
        organizationId,
        actorId,
      );

      sendResponse(res, 200, "User deleted successfully", user);
    } catch (err) {
      next(err);
    }
  },

  async restore(req: Request, res: Response, next: NextFunction) {
    const organizationId = requestContext.getValue("organizationId") as string;
    try {
      const user = await userService.restore(
        req.params.id as string,
        organizationId,
      );
      sendResponse(res, 200, "User restored successfully", user);
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = req.validated.body as CreateUserSchema;

      // const organizationId = requestContext.getValue(
      //   "organizationId",
      // ) as string;

      const user = await userService.createDirect(validated);

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

  async setPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = req.validated.body as SetPasswordSchema;
      const validatedParams = req.validated.params as SetPasswordParams;
      const response = await userService.setPassword(
        validated,
        validatedParams,
      );
      sendResponse(res, 200, "User created successfully", response);
    } catch (err) {
      next(err);
    }
  },

  async resetTokenExpirationDateInvitation(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const validated = req.validated
        .body as ResetTokenExpirationDateInvitationSchema;
      const response = await userService.resetTokenExpirationDateInvitation(
        validated.token,
        validated.email,
      );
      sendResponse(res, 200, "User created successfully", response);
    } catch (err) {
      next(err);
    }
  },

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
