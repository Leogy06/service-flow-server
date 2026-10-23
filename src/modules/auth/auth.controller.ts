import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { AppError } from "@/utils/AppError";
import { REFRESH_TOKEN_DAYS } from "@/utils/tokens";
import { sendResponse } from "@/utils/sendResponse";
import { profileService } from "./profile.service";
import { env } from "@/config/env";
import { clearRefreshCookies } from "@/middleware/clear-refresh-cookies";
import { twoFactorService, type CompletedLogin, type LoginHints } from "./two-factor.service";
import { clearTrustedDeviceCookies } from "./trusted-device.controller";

const refreshCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
};

function loginHints(req: Request): LoginHints {
  return {
    userAgent: req.get("user-agent") ?? "", ipAddress: req.ip ?? "",
    trustedTokens: {
      tenant: typeof req.cookies?.trustedDeviceTenant === "string" ? req.cookies.trustedDeviceTenant : undefined,
      "system-admin": typeof req.cookies?.trustedDeviceAdmin === "string" ? req.cookies.trustedDeviceAdmin : undefined,
    },
  };
}

function completeLogin(res: Response, result: CompletedLogin) {
  res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
  res.cookie("refreshToken", result.refreshToken, refreshCookieOptions);
  const { refreshToken: _refreshToken, trustedDevice, ...publicResult } = result;
  if (trustedDevice) {
    res.cookie(trustedDevice.surface === "tenant" ? "trustedDeviceTenant" : "trustedDeviceAdmin", trustedDevice.token, {
      httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict", path: "/api/auth", maxAge: trustedDevice.days * 86400000,
    });
  }
  sendResponse(res, 200, "User logged in successfully", publicResult);
}

export const authController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.register(
        req.validated.body as Parameters<typeof authService.register>[0],
      );
      sendResponse(
        res,
        202,
        "If eligible, your signup request is awaiting system administrator approval. Existing account holders can sign in.",
        result,
      );
    } catch (err) {
      next(err);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.validated?.body ?? req.body;
      const result = await authService.login(email, password, loginHints(req));
      if ("requiresTwoFactor" in result) {
        clearRefreshCookies(res);
        sendResponse(res, 200, result.deliveryStatus === "sent" ? "Enter the code sent to your email" : "We could not deliver the verification email. Please try resending the code.", result);
      } else completeLogin(res, result);
    } catch (err) {
      next(err);
    }
  },

  async verifyTwoFactor(req: Request, res: Response, next: NextFunction) {
    try {
      const { challengeId, code, rememberDevice } = req.validated.body as { challengeId: string; code: string; rememberDevice: boolean };
      completeLogin(res, await twoFactorService.verify(challengeId, code, rememberDevice, loginHints(req)));
    } catch (error) { next(error); }
  },

  async resendTwoFactor(req: Request, res: Response, next: NextFunction) {
    try {
      const { challengeId } = req.validated.body as { challengeId: string };
      const result = await twoFactorService.resend(challengeId);
      sendResponse(res, 200, result.deliveryStatus === "sent" ? "Verification code sent" : "We could not deliver the verification email. Please try resending the code.", result);
    } catch (error) { next(error); }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies.refreshToken;
      if (!token) throw new AppError(401, "No refresh token");

      const result = await authService.refresh(token);
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      res.cookie("refreshToken", result.refreshToken, refreshCookieOptions);
      res.json({ accessToken: result.accessToken });
    } catch (err) {
      res.clearCookie("refreshToken", { path: "/api/auth" });
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      next(err);
    }
  },


  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      clearRefreshCookies(res);
      const token = req.cookies.refreshToken;
      if (token) await authService.logout(token);
      res.json({ message: "Logged out" });
    } catch (err) {
      next(err);
    }
  },

  async logoutAll(_req: Request, res: Response, next: NextFunction) {
    try {
      await profileService.logoutAll();
      clearTrustedDeviceCookies(res);
      res.clearCookie("refreshToken", { path: "/api/auth" });
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      res.json({ message: "Logged out of all devices" });
    } catch (err) {
      next(err);
    }
  },

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(res, 200, "Current user fetched successfully", req.user!);
    } catch (err) {
      next(err);
    }
  },
};
