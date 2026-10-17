import { Router } from "express";
import { z } from "zod";
import { PERMISSIONS } from "@/constants/permission.constants";
import { requirePermission } from "@/middleware/require-permission";
import { validate } from "@/middleware/validate";
import { getDashboard } from "./dashboard.controller";

const routes = Router();
routes.get(
  "/",
  requirePermission(PERMISSIONS.DASHBOARD_READ),
  validate(z.object({ query: z.object({}).strict() })),
  getDashboard,
);
export default routes;
