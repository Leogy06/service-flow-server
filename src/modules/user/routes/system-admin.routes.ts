import { validate } from "@/middleware/validate";
import { Router } from "express";
import { systemAdminCreateSchema } from "../schemas/system-admin.schema";
import { writeLimmiter } from "@/middleware/rateLimiter";
import { systemAdminController } from "../controllers/system-admin.controller";
import { requirePlatformAdmin } from "@/middleware/require-platform-admin";

const systemAdminRoutes = Router();
systemAdminRoutes.use(requirePlatformAdmin);

systemAdminRoutes.post(
  "/",
  writeLimmiter,
  validate(systemAdminCreateSchema),
  systemAdminController.create,
);

export default systemAdminRoutes;
