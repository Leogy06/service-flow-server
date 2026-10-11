import { Router } from "express";
import { rolePermissionController } from "./role.permission.controller.js";
import {
  createRolePermissionSchema,
  updateRolePermission,
  rolePermissionParamsSchema,
} from "./role.permission.schema.js";
import { validate } from "@/middleware/validate.js";
import { authenticate } from "@/middleware/auth.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";

 const rolePermissionRoutes = Router();

rolePermissionRoutes.get(
  "/:roleId",
  authenticate,
  requirePermission(PERMISSIONS.ROLE_READ),
  validate(rolePermissionParamsSchema),
  rolePermissionController.list,
);
rolePermissionRoutes.post(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.ROLE_UPDATE),
  writeLimmiter,
  validate(createRolePermissionSchema),
  rolePermissionController.create,
);

rolePermissionRoutes.patch(
  "/:roleId",
  authenticate,
  requirePermission(PERMISSIONS.ROLE_UPDATE),
  writeLimmiter,
  validate(updateRolePermission),
  rolePermissionController.update,
);

export default rolePermissionRoutes
