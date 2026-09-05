import { Router } from "express";
import { userController } from "../controllers/user.controller.js";

//already authenticate in index route
export const userRoutes = Router();

userRoutes.get("/", userController.list);
userRoutes.get(
  "/list-for-permission-management/:organizationId",
  userController.listForPermissionManagement,
);
userRoutes.get("/by-id/:id", userController.getById);
userRoutes.post("/", userController.create);
userRoutes.put("/:id", userController.update);
userRoutes.delete("/:id", userController.delete);
userRoutes.patch("/:id/restore", userController.restore);
