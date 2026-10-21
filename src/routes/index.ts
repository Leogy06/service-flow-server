import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import { authenticate } from "@/middleware/auth";
import { apiLimiter, publicApiLimiter } from "@/middleware/rateLimiter";
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
import { tenantFeedbackRoutes, platformFeedbackRoutes, publicFeedbackRoutes } from "@/modules/feedback/feedback.routes";

export const router = Router();

router.use("/auth", authRoutes);
router.use("/feedback", tenantFeedbackRoutes);
router.use("/system-admin/feedback", platformFeedbackRoutes);
router.use("/public/feedback", publicFeedbackRoutes);
router.use("/users", authenticate, apiLimiter, userRoutes);
router.use("/organization", organizationRoutes);
router.use("/customers", authenticate, apiLimiter, customerRoutes);
router.use("/service-requests", authenticate, apiLimiter, serviceRequestRoutes);
router.use("/jobs", authenticate, apiLimiter, jobRoutes);
router.use("/invoices", authenticate, apiLimiter, invoiceRoutes);
router.use("/permission", permissionRoutes);
router.use("/role-permission", rolePermissionRoutes);
router.use("/user-permission", userPermissionRoutes);
router.use("/role", authenticate, apiLimiter, roleRoutes);
router.use("/system-admin", systemAdminRoutes);
router.use("/audit-logs", authenticate, apiLimiter, auditRoutes);
router.use("/dashboard", authenticate, apiLimiter, dashboardRoutes);

router.get("/health", (_req, res) => res.json({ status: "ok" }));
// Unmatched paths retain a default abuse budget before the 404 handler.
router.use(publicApiLimiter);
