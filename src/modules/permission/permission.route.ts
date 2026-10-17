import { permissionController } from "./permission.controller";
import { validate } from "@/middleware/validate";
import { createPermissionSchema } from "./permission.schema";
import { Router } from "express";
import { authenticate } from "@/middleware/auth";
import { requirePlatformAdmin } from "@/middleware/require-platform-admin";

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
