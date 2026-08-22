import { Router } from "express";
import { organizationController } from "@/controllers/organization.controller.js";
import { validate } from "@/middleware/validate.js";
import { organizationSchema } from "@/schemas/organization.schema.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";

export const organizationRoutes = Router();

organizationRoutes.get("/", organizationController.list);
organizationRoutes.post("/", writeLimmiter, validate(organizationSchema) , organizationController.create);
