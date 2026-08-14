import { Router } from "express";
import { userRoutes } from "@/routes/user.routes.js";
export const router = Router();
router.use("/users", userRoutes);
router.get("/health", (_req, res) => res.json({ status: "ok" }));
//# sourceMappingURL=index.js.map