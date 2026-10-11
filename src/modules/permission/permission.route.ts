import { permissionController } from "./permission.controller.js";
import { validate } from "@/middleware/validate.js";
import { createPermissionSchema } from "./permission.schema.js";
import { Router } from "express";
import { authenticate } from "@/middleware/auth.js";
import { requirePlatformAdmin } from "@/middleware/require-platform-admin.js";

const permissionRoutes = Router();
permissionRoutes.use(authenticate);
permissionRoutes.get("/", permissionController.list);

permissionRoutes.post(
  "/",
  requirePlatformAdmin,
  validate(createPermissionSchema),
  permissionController.create,
);

export default permissionRoutes;
