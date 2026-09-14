import { Router } from "express";
import { rolePermissionController } from "./role.permission.controller.js";
import {
  createRolePermissionSchema,
  updateRolePermission,
} from "./role.permission.schema.js";
import { validate } from "@/middleware/validate.js";
import { authenticate } from "@/middleware/auth.js";

export const rolePermissionRoutes = Router();

rolePermissionRoutes.get(
  "/:roleId",
  authenticate,
  rolePermissionController.list,
);
rolePermissionRoutes.post(
  "/",
  authenticate,
  validate(createRolePermissionSchema),
  rolePermissionController.create,
);

rolePermissionRoutes.patch(
  "/:roleId",
  authenticate,
  validate(updateRolePermission),
  rolePermissionController.update,
);
