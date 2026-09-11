import { Router } from "express";
import { userController } from "../controllers/user.controller.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import { validate } from "@/middleware/validate.js";
import { userSchema } from "@/schemas/user.schema.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";

//already authenticate in index route
export const userRoutes = Router();

userRoutes.get("/", userController.list);
userRoutes.get(
  "/list-for-permission-management",
  userController.listForPermissionManagement,
);
userRoutes.get("/by-id/:id", userController.getById);
userRoutes.post(
  "/",
  writeLimmiter,
  requirePermission(PERMISSIONS.USER_CREATE),
  validate(userSchema),
  userController.create,
);
userRoutes.put("/:id", userController.update);
userRoutes.delete("/:id", userController.delete);
userRoutes.patch("/:id/restore", userController.restore);
