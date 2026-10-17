import { Router } from "express";
import { authenticate } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { registerSchema, loginSchema } from "@/modules/auth/auth.schema";
import { authController } from "@/modules/auth/auth.controller";
import {
  authLimiter,
  signupLimiter,
  strictLimiter,
  writeLimmiter,
} from "@/middleware/rateLimiter";
import { profileController } from "./profile.controller";
import { updateProfileSchema, changePasswordSchema } from "./profile.schema";
import { setPasswordSchema } from "@/modules/user/user.schema";
import { userController } from "@/modules/user/user.controller";

const router = Router();

router.post(
  "/register",
  signupLimiter,
  authLimiter,
  validate(registerSchema),
  authController.register,
);
router.post("/login", authLimiter, validate(loginSchema), authController.login);
router.post(
  "/set-password",
  strictLimiter,
  validate(setPasswordSchema),
  userController.setPassword,
);
router.post("/refresh", authLimiter, authController.refresh);
router.post("/logout", authController.logout);
router.post(
  "/logout-all",
  authenticate,
  strictLimiter,
  authController.logoutAll,
);
router.get("/me", authenticate, authController.me);
router.get("/profile", authenticate, profileController.get);
router.patch(
  "/profile",
  authenticate,
  writeLimmiter,
  validate(updateProfileSchema),
  profileController.update,
);
router.post(
  "/change-password",
  authenticate,
  strictLimiter,
  validate(changePasswordSchema),
  profileController.changePassword,
);

export default router;
