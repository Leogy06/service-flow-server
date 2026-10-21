import { permissionController } from "./permission.controller";
import { validate } from "@/middleware/validate";
import { createPermissionSchema } from "./permission.schema";
import { Router } from "express";
import { authenticate } from "@/middleware/auth";
import { apiLimiter, writeLimmiter } from "@/middleware/rateLimiter";
import { requirePlatformAdmin } from "@/middleware/require-platform-admin";

const permissionRoutes = Router();
permissionRoutes.use(authenticate, apiLimiter);
permissionRoutes.get("/", permissionController.list);

permissionRoutes.post(
  "/",
  requirePlatformAdmin,
  writeLimmiter,
  validate(createPermissionSchema),
  permissionController.create,
);

export default permissionRoutes;
