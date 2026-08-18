import { Router } from "express";
import { userController } from "../controllers/user.controller.js";

export const userRoutes = Router();

userRoutes.get("/", userController.list);
userRoutes.get("/:id", userController.getById);
userRoutes.post("/", userController.create);
userRoutes.put("/:id", userController.update);
userRoutes.delete("/:id", userController.delete);
userRoutes.patch("/:id/restore", userController.restore);
