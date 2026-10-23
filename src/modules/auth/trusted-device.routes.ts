import { Router } from "express";
import { z } from "zod";
import { authenticate } from "@/middleware/auth";
import { apiLimiter, strictLimiter, writeLimmiter } from "@/middleware/rateLimiter";
import { validate } from "@/middleware/validate";
import { trustedDeviceController } from "./trusted-device.controller";

const router = Router();
const deviceParams = z.object({ params: z.object({ id: z.string().trim().min(1).max(191).regex(/^[a-zA-Z0-9_-]+$/) }).strict() });
router.use(authenticate, apiLimiter);
router.get("/", trustedDeviceController.list);
router.delete("/", strictLimiter, trustedDeviceController.revokeAll);
router.delete("/:id", writeLimmiter, validate(deviceParams), trustedDeviceController.revoke);

export default router;
