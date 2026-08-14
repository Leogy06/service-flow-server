import { Router } from "express";
import { userController } from "@/controllers/user.controller.js";
export const userRoutes = Router();
userRoutes.get("/", userController.list);
userRoutes.get("/:id", userController.getById);
userRoutes.post("/", userController.create);
//# sourceMappingURL=user.routes.js.map