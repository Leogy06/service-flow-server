import { Request, Response, NextFunction } from "express";
// import { z } from "zod";
import { userService } from "../services/user.service.js";

// const createUserSchema = z.object({
//   email: z.string().email(),
//   name: z.string().min(1),
// });

export const userController = {
  async list(_: Request, res: Response, next: NextFunction) {
    try {
      const users = await userService.list();
      res.json(users);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.getById(req.params.id as string);
      res.json(user);
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
