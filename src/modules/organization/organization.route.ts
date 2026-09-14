import { Router } from "express";
import { organizationController } from "./organization.controller.js";
import { validate } from "@/middleware/validate.js";
import { organizationSchema } from "./organization.schema.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
 const  organizationRoutes = Router();

organizationRoutes.get("/", organizationController.list);
organizationRoutes.post(
  "/",
  writeLimmiter,
  validate(organizationSchema),
  organizationController.create,
);
organizationRoutes.get("/by-id/:id", organizationController.getById);
organizationRoutes.get("/check-slug/:slug", organizationController.checkSlug);

export default organizationRoutes;