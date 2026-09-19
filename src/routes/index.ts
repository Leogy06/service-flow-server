import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes.js";
import { authenticate } from "@/middleware/auth.js";
import permissionRoutes from "@/modules/permission/permission.route.js";
import userPermissionRoutes from "@/modules/user-permission/user.permission.routes.js";
import roleRoutes from "@/modules/role/role.routes.js";
import customerRoutes from "@/modules/customer/customer.routes.js";
import rolePermissionRoutes from "@/modules/role-permission/role.permission.routes.js";
import userRoutes from "@/modules/user/user.routes.js";
import organizationRoutes from "@/modules/organization/organization.route.js";

export const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/organization", organizationRoutes);
router.use("/customers", authenticate, customerRoutes);
router.use("/permission", permissionRoutes);
router.use("/role-permission", rolePermissionRoutes);
router.use("/user-permission", userPermissionRoutes);
router.use("/role", roleRoutes);

router.get("/health", (_req, res) => res.json({ status: "ok" }));
