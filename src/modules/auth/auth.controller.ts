import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { AppError } from "@/utils/AppError";
import { REFRESH_TOKEN_DAYS } from "@/utils/tokens";
import { sendResponse } from "@/utils/sendResponse";
import { profileService } from "./profile.service";

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
};

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
      const { email, password } = req.body;
      const result = await authService.login(email, password);

      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      res.cookie("refreshToken", result.refreshToken, refreshCookieOptions);
      const { refreshToken: _refreshToken, ...publicResult } = result;
      sendResponse(res, 200, "User logged in successfully", publicResult);
    } catch (err) {
      next(err);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies.refreshToken;
      if (!token) throw new AppError(401, "No refresh token");

      const result = await authService.refresh(token);
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      res.cookie("refreshToken", result.refreshToken, refreshCookieOptions);
      reson({ accessToken: result.accessToken });
    } catch (err) {
      res.clearCookie("refreshToken", { path: "/api/auth" });
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      next(err);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies.refreshToken;
      if (token) await authService.logout(token);
      res.clearCookie("refreshToken", { path: "/api/auth" });
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      reson({ message: "Logged out" });
    } catch (err) {
      next(err);
    }
  },

  async logoutAll(_req: Request, res: Response, next: NextFunction) {
    try {
      await profileService.logoutAll();
      res.clearCookie("refreshToken", { path: "/api/auth" });
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      reson({ message: "Logged out of all devices" });
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
