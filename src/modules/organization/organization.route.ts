import { Router } from "express";
import { organizationController } from "./organization.controller";
import { validate } from "@/middleware/validate";
import {
  organizationSchema,
  subscriptionSummarySchema,
  requestSubscriptionUpgradeSchema,
} from "./organization.schema";
import { apiLimiter, publicApiLimiter, writeLimmiter } from "@/middleware/rateLimiter";
import { authenticate } from "@/middleware/auth";
import { requireSystemAdmin } from "@/middleware/require-platform-admin";
import { brandingRoutes } from "./branding.routes";
import { organizationPageRoutes } from "./page.routes";
const organizationRoutes = Router();
organizationRoutes.use(brandingRoutes);
organizationRoutes.use(organizationPageRoutes);

organizationRoutes.get(
  "/",
  authenticate,
  apiLimiter,
  requireSystemAdmin,
  organizationController.list,
);
organizationRoutes.get(
  "/subscription",
  authenticate,
  apiLimiter,
  validate(subscriptionSummarySchema),
  organizationController.subscription,
);
organizationRoutes.get(
  "/subscription/plans",
  authenticate,
  apiLimiter,
  validate(subscriptionSummarySchema),
  organizationController.upgradePlans,
);
organizationRoutes.post(
  "/subscription/upgrade-requests",
  authenticate,
  apiLimiter,
  writeLimmiter,
  validate(requestSubscriptionUpgradeSchema),
  organizationController.requestUpgrade,
);
organizationRoutes.post(
  "/",
  authenticate,
  apiLimiter,
  requireSystemAdmin,
  writeLimmiter,
  validate(organizationSchema),
  organizationController.create,
);
organizationRoutes.get(
  "/by-id/:id",
  authenticate,
  apiLimiter,
  organizationController.getById,
);
organizationRoutes.get("/check-slug/:slug", publicApiLimiter, organizationController.checkSlug);

export default organizationRoutes;
