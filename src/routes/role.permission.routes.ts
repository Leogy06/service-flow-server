import { Router } from "express";
import { permissionController } from "@/controllers/role.permission.controller.js";
import { createRolePermissionSchema } from "@/schemas/role.permission.schema.js";
import { validate } from "@/middleware/validate.js";
import { authenticate } from "@/middleware/auth.js";

export const rolePermissionRoutes = Router();

rolePermissionRoutes.get("/:roleId", authenticate, permissionController.list);
rolePermissionRoutes.post(
  "/",
  authenticate,
  validate(createRolePermissionSchema),
  permissionController.create,
);
