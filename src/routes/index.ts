import { Router } from "express";
import { userRoutes } from "./user.routes.js";
import { organizationRoutes } from "./organization.route.js";
import authRoutes from "./auth.routes.js";
import { authenticate } from "@/middleware/auth.js";
import { customerRoutes } from "./customer.routes.js";

export const router = Router();

router.use("/auth", authRoutes);
router.use("/users", authenticate, userRoutes);
router.use("/organization", authenticate, organizationRoutes);
router.use("/customers", authenticate, customerRoutes);
router.get("/health", (_req, res) => res.json({ status: "ok" }));
