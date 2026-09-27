import { userPermissionController } from "./user.permission.controller.js";
import { authenticate } from "@/middleware/auth.js";
import { validate } from "@/middleware/validate.js";
import { updateUserPermissionSchema } from "./user.permission.schema.js";
import { Router } from "express";

const userPermissionRoutes = Router();

userPermissionRoutes.patch(
  "/:userId",
  authenticate,
  validate(updateUserPermissionSchema),
  userPermissionController.updatePermissions,
);

userPermissionRoutes.patch(
  "/system-admin/:userId",
  authenticate,
  validate(updateUserPermissionSchema),
  userPermissionController.systemAdminUpdatePermissions,
);

export default userPermissionRoutes;
