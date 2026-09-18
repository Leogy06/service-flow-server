import { roleController } from "./role.controller.js";
import { authenticate } from "@/middleware/auth.js";
import { Router } from "express";

const roleRoutes = Router();

//just option for creating user
roleRoutes.get("/", authenticate, roleController.list);

export default roleRoutes;
