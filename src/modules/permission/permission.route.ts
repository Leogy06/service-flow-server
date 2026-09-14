import { permissionController } from "./permission.controller.js";
import { validate } from "@/middleware/validate.js";
import { createPermissionSchema } from "./permission.schema.js";
import { Router } from "express";

const permissionRoutes = Router();

permissionRoutes.post(
  "/",
  validate(createPermissionSchema),
  permissionController.create,
);

export default permissionRoutes;
