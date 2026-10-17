import { roleController } from "./role.controller";
import { Router } from "express";
import {
  createRoleSchema,
  updateRoleSchema,
  roleParamsSchema,
  listRolesSchema,
  restoreRoleSchema,
} from "./role.schema";
import { validate } from "@/middleware/validate";
import { requirePermission } from "@/middleware/require-permission";
import { PERMISSIONS } from "@/constants/permission.constants";
import { deleteLimiter, writeLimmiter } from "@/middleware/rateLimiter";

const roleRoutes = Router();
roleRoutes.get(
  "/",
  requirePermission(PERMISSIONS.ROLE_READ),
  validate(listRolesSchema),
  roleController.list,
);
roleRoutes.get("/assignable", roleController.listAssignable);
roleRoutes.get(
  "/:id",
  requirePermission(PERMISSIONS.ROLE_READ),
  validate(roleParamsSchema),
  roleController.getById,
);
roleRoutes.post(
  "/",
  requirePermission(PERMISSIONS.ROLE_CREATE),
  writeLimmiter,
  validate(createRoleSchema),
  roleController.create,
);
roleRoutes.patch(
  "/:id",
  requirePermission(PERMISSIONS.ROLE_UPDATE),
  writeLimmiter,
  validate(updateRoleSchema),
  roleController.update,
);
roleRoutes.patch(
  "/:id/restore",
  requirePermission(PERMISSIONS.ROLE_UPDATE),
  writeLimmiter,
  validate(restoreRoleSchema),
  roleController.restore,
);
roleRoutes.delete(
  "/:id",
  requirePermission(PERMISSIONS.ROLE_DELETE),
  deleteLimiter,
  validate(roleParamsSchema),
  roleController.delete,
);
export default roleRoutes;
