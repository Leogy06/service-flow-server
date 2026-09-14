import { Router } from "express";
import { userController } from "./user.controller.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import { validate } from "@/middleware/validate.js";
import { createUserInviteSchema, createUserSchema } from "./user.schema.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { authenticate } from "@/middleware/auth.js";

//already authenticate in index route
const userRoutes = Router();

userRoutes.get("/", authenticate, userController.list);
userRoutes.get(
  "/list-for-permission-management",
  authenticate,
  userController.listForPermissionManagement,
);
userRoutes.get("/by-id/:id", userController.getById);
userRoutes.post(
  "/",
  writeLimmiter,
  requirePermission(PERMISSIONS.USER_CREATE),
  validate(createUserSchema),
  userController.create,
);
userRoutes.post(
  "/invite-email",
  authenticate,
  writeLimmiter,
  requirePermission(PERMISSIONS.USER_CREATE),
  validate(createUserInviteSchema),
  userController.createWithInvite,
);

userRoutes.put("/:id", authenticate, userController.update);
userRoutes.put(
  "/set-password/:token/:email",
  authenticate,
  userController.setPassword,
);
userRoutes.delete("/:id", authenticate, userController.delete);
userRoutes.patch("/:id/restore", authenticate, userController.restore);

export default userRoutes;
