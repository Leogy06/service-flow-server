import { Router } from "express";
import { z } from "zod";
import { PERMISSIONS } from "@/constants/permission.constants.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { validate } from "@/middleware/validate.js";
import { getDashboard } from "./dashboard.controller.js";

const routes = Router();
routes.get("/", requirePermission(PERMISSIONS.DASHBOARD_READ),
  validate(z.object({ query: z.object({}).strict() })), getDashboard);
export default routes;
