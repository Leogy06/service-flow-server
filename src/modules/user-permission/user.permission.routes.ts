import { Router } from "express";
import { userPermissionController } from "./user.permission.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/require-permission";
import { requirePlatformAdmin } from "@/middleware/require-platform-admin";
import { PERMISSIONS } from "@/constants/permission.constants";
import { validate } from "@/middleware/validate";
import { writeLimmiter } from "@/middleware/rateLimiter";
import {
  updateUserPermissionSchema,
  userPermissionParamsSchema,
  platformUserPermissionSchema,
} from "./user.permission.schema";

const userPermissionRoutes = Router();
userPermissionRoutes.use(authenticate);
userPermissionRoutes.patch(
  "/system-admin/:userId",
  requirePlatformAdmin,
  writeLimmiter,
  validate(platformUserPermissionSchema),
  userPermissionController.systemAdminUpdatePermissions,
);
userPermissionRoutes.get(
  "/:userId",
  requirePermission(PERMISSIONS.USER_READ),
  validate(userPermissionParamsSchema),
  userPermissionController.getById,
);
userPermissionRoutes.patch(
  "/:userId",
  requirePermission(PERMISSIONS.USER_UPDATE),
  writeLimmiter,
  validate(updateUserPermissionSchema),
  userPermissionController.updatePermissions,
);
export default userPermissionRoutes;
