import { PERMISSIONS } from "@/constants/permission.constants.js";
import { roleController } from "@/controllers/role.controller.js";
import { authenticate } from "@/middleware/auth.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { Router } from "express";

const roleRoutes = Router();

roleRoutes.get("/", authenticate, requirePermission(PERMISSIONS.ROLE_READ), roleController.list);

export default roleRoutes;
