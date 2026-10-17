import { Router } from "express";
import { rolePermissionController } from "./role.permission.controller";
import {
  createRolePermissionSchema,
  updateRolePermission,
  rolePermissionParamsSchema,
} from "./role.permission.schema";
import { validate } from "@/middleware/validate";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/require-permission";
import { PERMISSIONS } from "@/constants/permission.constants";
import { writeLimmiter } from "@/middleware/rateLimiter";

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

export default rolePermissionRoutes;
