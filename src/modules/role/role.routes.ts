import { roleController } from "./role.controller.js";
import { Router } from "express";
import { createRoleSchema } from "./role.schema.js";
import { validate } from "@/middleware/validate.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { PERMISSIONS } from "@/constants/permission.constants.js";

const roleRoutes = Router();

//just option for creating user
roleRoutes.get(
  "/",
  requirePermission(PERMISSIONS.ROLE_READ),
  roleController.list,
);
roleRoutes.post( 
  "/",
  requirePermission(PERMISSIONS.ROLE_CREATE),
  validate(createRoleSchema),
  roleController.create,
);

export default roleRoutes;
