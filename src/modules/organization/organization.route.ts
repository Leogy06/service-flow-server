import { Router } from "express";
import { organizationController } from "./organization.controller.js";
import { validate } from "@/middleware/validate.js";
import { organizationSchema } from "./organization.schema.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { authenticate } from "@/middleware/auth.js";
import { requireSystemAdmin } from "@/middleware/require-platform-admin.js";
 const  organizationRoutes = Router();

organizationRoutes.get("/", authenticate, requireSystemAdmin, organizationController.list);
organizationRoutes.post(
  "/",
  authenticate,
  requireSystemAdmin,
  writeLimmiter,
  validate(organizationSchema),
  organizationController.create,
);
organizationRoutes.get("/by-id/:id", authenticate, organizationController.getById);
organizationRoutes.get("/check-slug/:slug", organizationController.checkSlug);

export default organizationRoutes;
