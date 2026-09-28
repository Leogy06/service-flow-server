import { Router } from "express";
import { userController } from "./user.controller.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import { validate } from "@/middleware/validate.js";
import {
  createUserInviteSchema,
  createUserSchema,
  resetTokenExpirationDateInvitationSchema,
  setPasswordParams,
  userUpdateSchema,
} from "./user.schema.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";

//already authenticate in index route
const userRoutes = Router();

userRoutes.get("/", userController.list);
userRoutes.post(
  "/",
  writeLimmiter,
  validate(createUserSchema),
  userController.create,
);
//update user
userRoutes.put(
  "/:id",
  writeLimmiter,
  validate(userUpdateSchema),
  requirePermission(PERMISSIONS.USER_UPDATE),
  userController.update,
);

userRoutes.post(
  "/invite-email",
  writeLimmiter,
  validate(createUserInviteSchema),
  requirePermission(PERMISSIONS.USER_CREATE),
  userController.createWithInvite,
);
userRoutes.get(
  "/list-for-permission-management",
  userController.listForPermissionManagement,
);
userRoutes.put(
  "/reset-token-expiration-date",
  validate(resetTokenExpirationDateInvitationSchema),
  userController.resetTokenExpirationDateInvitation,
);
userRoutes.put(
  "/set-password/:token/:email",
  validate(setPasswordParams),
  userController.setPassword,
);
userRoutes.patch("/:id/restore", userController.restore);
userRoutes.put("/:id", userController.update);
userRoutes.delete("/:id", userController.delete);
userRoutes.get(
  "/list-for-permission-management",
  userController.listForPermissionManagement,
);

export default userRoutes;
