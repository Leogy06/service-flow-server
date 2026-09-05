import { Router } from "express";
import { permissionController } from "@/controllers/permission.controller.js";

export const permissionRoutes = Router();

permissionRoutes.get("/:roleId", permissionController.permissions);
