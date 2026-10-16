import { Router } from "express";
import { userController } from "./user.controller.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import { validate } from "@/middleware/validate.js";
import {
  createUserInviteSchema,
  createUserSchema,
  resetTokenExpirationDateInvitationSchema,
  userUpdateSchema,
  userListQuerySchema,
  assignUserRoleSchema,
  userParamsSchema,
} from "./user.schema.js";
import { deleteLimiter, strictLimiter, writeLimmiter } from "@/middleware/rateLimiter.js";
import { resetStaffPasswordSchema } from "./user-password.schema.js";
import { userPermissionController } from "@/modules/user-permission/user.permission.controller.js";

//already authenticate in index route
const userRoutes = Router();

userRoutes.get("/", requirePermission(PERMISSIONS.USER_READ), validate(userListQuerySchema), userController.list);
userRoutes.get("/roles", requirePermission(PERMISSIONS.USER_READ), userController.listRoles);
userRoutes.post("/:id/reset-password", requirePermission(PERMISSIONS.USER_UPDATE), strictLimiter, validate(resetStaffPasswordSchema), userController.resetStaffPassword);
userRoutes.patch("/:id/role", requirePermission(PERMISSIONS.USER_UPDATE), writeLimmiter, validate(assignUserRoleSchema), userPermissionController.assignRole);
userRoutes.post(
  "/",
  requirePermission(PERMISSIONS.USER_CREATE),
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
  requirePermission(PERMISSIONS.USER_READ),
  userController.listForPermissionManagement,
);
userRoutes.put(
  "/reset-token-expiration-date",
  validate(resetTokenExpirationDateInvitationSchema),
  userController.resetTokenExpirationDateInvitation,
);
userRoutes.patch("/:id/restore", requirePermission(PERMISSIONS.USER_UPDATE), writeLimmiter, validate(userParamsSchema), userController.restore);
userRoutes.delete(
  "/:id",
  deleteLimiter,
  requirePermission(PERMISSIONS.USER_DELETE),
  validate(userParamsSchema),
  userController.delete,
);

export default userRoutes;
