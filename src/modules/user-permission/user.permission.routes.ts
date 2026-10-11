import { Router } from "express";
import { userPermissionController } from "./user.permission.controller.js";
import { authenticate } from "@/middleware/auth.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { requirePlatformAdmin } from "@/middleware/require-platform-admin.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import { validate } from "@/middleware/validate.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { updateUserPermissionSchema, userPermissionParamsSchema } from "./user.permission.schema.js";

const userPermissionRoutes = Router();
userPermissionRoutes.use(authenticate);
userPermissionRoutes.patch("/system-admin/:userId", requirePlatformAdmin, writeLimmiter, validate(updateUserPermissionSchema), userPermissionController.systemAdminUpdatePermissions);
userPermissionRoutes.get("/:userId", requirePermission(PERMISSIONS.USER_READ), validate(userPermissionParamsSchema), userPermissionController.getById);
userPermissionRoutes.patch("/:userId", requirePermission(PERMISSIONS.USER_UPDATE), writeLimmiter, validate(updateUserPermissionSchema), userPermissionController.updatePermissions);
export default userPermissionRoutes;