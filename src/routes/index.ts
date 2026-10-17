import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import { authenticate } from "@/middleware/auth";
import permissionRoutes from "@/modules/permission/permission.route";
import userPermissionRoutes from "@/modules/user-permission/user.permission.routes";
import roleRoutes from "@/modules/role/role.routes";
import customerRoutes from "@/modules/customer/customer.routes";
import serviceRequestRoutes from "@/modules/service-request/service-request.routes";
import jobRoutes from "@/modules/job/job.routes";
import invoiceRoutes from "@/modules/invoice/invoice.routes";
import rolePermissionRoutes from "@/modules/role-permission/role.permission.routes";
import userRoutes from "@/modules/user/user.routes";
import organizationRoutes from "@/modules/organization/organization.route";
import systemAdminRoutes from "@/modules/system-admin/system-admin.routes";
import auditRoutes from "@/modules/audit/audit.routes";
import dashboardRoutes from "@/modules/dashboard/dashboard.routes";

export const router = Router();

router.use("/auth", authRoutes);
router.use("/users", authenticate, userRoutes);
router.use("/organization", organizationRoutes);
router.use("/customers", authenticate, customerRoutes);
router.use("/service-requests", authenticate, serviceRequestRoutes);
router.use("/jobs", authenticate, jobRoutes);
router.use("/invoices", authenticate, invoiceRoutes);
router.use("/permission", permissionRoutes);
router.use("/role-permission", rolePermissionRoutes);
router.use("/user-permission", userPermissionRoutes);
router.use("/role", authenticate, roleRoutes);
router.use("/system-admin", systemAdminRoutes);
router.use("/audit-logs", authenticate, auditRoutes);
router.use("/dashboard", authenticate, dashboardRoutes);

router.get("/health", (_req, res) => reson({ status: "ok" }));
