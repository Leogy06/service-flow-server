import { userPermissionController } from "@/controllers/user.permission.controller.js";
import { authenticate } from "@/middleware/auth.js";
import { validate } from "@/middleware/validate.js";
import { updateUserPermissionSchema } from "@/schemas/user.permission.schema.js";
import { Router } from "express";

const userPermissionRoutes = Router();

userPermissionRoutes.patch(
  "/:userId",
  authenticate,
  validate(updateUserPermissionSchema),
  userPermissionController.updatePermissions,
);

export default userPermissionRoutes;
