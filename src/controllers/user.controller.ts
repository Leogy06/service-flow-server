import { Request, Response, NextFunction } from "express";
// import { z } from "zod";
import { userService } from "@/services/user.service.js";
import { sendResponse } from "@/utils/sendResponse.js";


export const userController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const users = await userService.list();
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

  // async create(req: Request, res: Response, next: NextFunction) {
  //   try {
  //     const parsed = createUserSchema.parse(req.body);
  //     const user = await userService.create(parsed);
  //     res.status(201).json(user);
  //   } catch (err) {
  //     next(err);
  //   }
  // },
};
