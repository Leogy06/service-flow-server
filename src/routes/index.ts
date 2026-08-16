import { Router } from "express";
import { userRoutes } from "@/routes/user.routes.js";
import authRoutes from "@/routes/auth.routes.js";

export const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.get("/health", (_req, res) => res.json({ status: "ok" }));
