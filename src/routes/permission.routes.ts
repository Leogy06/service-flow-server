import { Router } from "express";
import { permissionController } from "@/controllers/permission.controller.js";
import { createPermissionSchema } from "@/schemas/permission.schema.js";
import { validate } from "@/middleware/validate.js";
import { authenticate } from "@/middleware/auth.js";

export const permissionRoutes = Router();

permissionRoutes.get("/:roleId", authenticate, permissionController.list);
permissionRoutes.post(
  "/",
  authenticate,
  validate(createPermissionSchema),
  permissionController.create,
);
