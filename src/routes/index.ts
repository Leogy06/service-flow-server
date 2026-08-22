import { Router } from "express";
import { userRoutes } from "./user.routes.js";
import { organizationRoutes } from "./organization.route.js";
import authRoutes from "./auth.routes.js";
import { authenticate, requireRole } from "@/middleware/auth.js";

export const router = Router();

router.use("/auth", authRoutes);
router.use("/users", authenticate, requireRole("TENANT_ADMIN"), userRoutes);
router.use(
  "/organization",
  authenticate,
  requireRole("TENANT_ADMIN"),
  organizationRoutes,
);
router.get("/health", (_req, res) => res.json({ status: "ok" }));
