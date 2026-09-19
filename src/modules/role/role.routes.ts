import { roleController } from "./role.controller.js";
import { Router } from "express";
import { createRoleSchema } from "./role.schema.js";
import { validate } from "@/middleware/validate.js";

const roleRoutes = Router();

//just option for creating user
roleRoutes.get("/", roleController.list);
roleRoutes.post("/", validate(createRoleSchema), roleController.create);

export default roleRoutes;
