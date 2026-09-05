import { permissionController } from "@/controllers/role.permission.controller.js";
import { validate } from "@/middleware/validate.js";
import { createPermissionSchema } from "@/schemas/permission.schema.js";
import { Router } from "express";

const permissionRoutes = Router();

permissionRoutes.post(
  "/",
  validate(createPermissionSchema),
  permissionController.create,
);

export default permissionRoutes;
