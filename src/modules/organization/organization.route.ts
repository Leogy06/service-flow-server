import { Router } from "express";
import { organizationController } from "./organization.controller";
import { validate } from "@/middleware/validate";
import {
  organizationSchema,
  subscriptionSummarySchema,
  requestSubscriptionUpgradeSchema,
} from "./organization.schema";
import { writeLimmiter } from "@/middleware/rateLimiter";
import { authenticate } from "@/middleware/auth";
import { requireSystemAdmin } from "@/middleware/require-platform-admin";
import { brandingRoutes } from "./branding.routes";
const organizationRoutes = Router();
organizationRoutes.use(brandingRoutes);

organizationRoutes.get(
  "/",
  authenticate,
  requireSystemAdmin,
  organizationController.list,
);
organizationRoutes.get(
  "/subscription",
  authenticate,
  validate(subscriptionSummarySchema),
  organizationController.subscription,
);
organizationRoutes.get(
  "/subscription/plans",
  authenticate,
  validate(subscriptionSummarySchema),
  organizationController.upgradePlans,
);
organizationRoutes.post(
  "/subscription/upgrade-requests",
  authenticate,
  writeLimmiter,
  validate(requestSubscriptionUpgradeSchema),
  organizationController.requestUpgrade,
);
organizationRoutes.post(
  "/",
  authenticate,
  requireSystemAdmin,
  writeLimmiter,
  validate(organizationSchema),
  organizationController.create,
);
organizationRoutes.get(
  "/by-id/:id",
  authenticate,
  organizationController.getById,
);
organizationRoutes.get("/check-slug/:slug", organizationController.checkSlug);

export default organizationRoutes;
