import { Router } from "express";
import { authenticate } from "@/middleware/auth";
import { clearLogoutCookies } from "@/middleware/clear-refresh-cookies";
import { validate } from "@/middleware/validate";
import { registerSchema, loginSchema, verifyTwoFactorSchema, resendTwoFactorSchema } from "@/modules/auth/auth.schema";
import { authController } from "@/modules/auth/auth.controller";
import {
  authLimiter,
  apiLimiter,
  publicApiLimiter,
  refreshLimiter,
  signupLimiter,
  strictLimiter,
  writeLimmiter,
} from "@/middleware/rateLimiter";
import { profileController } from "./profile.controller";
import { updateProfileSchema, changePasswordSchema } from "./profile.schema";
import { setPasswordSchema } from "@/modules/user/user.schema";
import { userController } from "@/modules/user/user.controller";
import { twoFactorDeliveryIpLimiter, twoFactorDeliveryAccountLimiter, twoFactorVerifyLimiter } from "@/middleware/two-factor-rate-limit";
import trustedDeviceRoutes from "./trusted-device.routes";

const router = Router();

router.post(
  "/register",
  signupLimiter,
  validate(registerSchema),
  authController.register,
);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.post("/login", authLimiter, twoFactorDeliveryIpLimiter, validate(loginSchema), twoFactorDeliveryAccountLimiter, authController.login);
router.post("/2fa/verify", twoFactorVerifyLimiter, validate(verifyTwoFactorSchema), authController.verifyTwoFactor);
router.post("/2fa/resend", twoFactorDeliveryIpLimiter, validate(resendTwoFactorSchema), twoFactorDeliveryAccountLimiter, authController.resendTwoFactor);
router.use("/trusted-devices", trustedDeviceRoutes);
router.post(
  "/set-password",
  strictLimiter,
  validate(setPasswordSchema),
  userController.setPassword,
);
router.post("/refresh", refreshLimiter, authController.refresh);
router.post("/logout", clearLogoutCookies, publicApiLimiter, authController.logout);
router.post(
  "/logout-all",
  authenticate,
  apiLimiter,
  strictLimiter,
  authController.logoutAll,
);
router.get("/me", authenticate, apiLimiter, authController.me);
router.get("/profile", authenticate, apiLimiter, profileController.get);
router.patch(
  "/profile",
  authenticate,
  apiLimiter,
  writeLimmiter,
  validate(updateProfileSchema),
  profileController.update,
);
router.post(
  "/change-password",
  authenticate,
  apiLimiter,
  strictLimiter,
  validate(changePasswordSchema),
  profileController.changePassword,
);

export default router;
