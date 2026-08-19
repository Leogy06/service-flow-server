import { Request, Response, NextFunction } from "express";
import { authService } from "@/services/auth.service.js";
import { AppError } from "@/utils/AppError.js";
import { REFRESH_TOKEN_DAYS } from "@/utils/tokens.js";
import { sendResponse } from "@/utils/sendResponse.js";

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/auth/refresh",
  maxAge: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
};

export const authController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await authService.register(req.body);
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);

    
      res.cookie("refreshToken", result.refreshToken, refreshCookieOptions);
      res.json({ accessToken: result.accessToken, user: result.user });
    } catch (err) {
      next(err);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies.refreshToken;
      if (!token) throw new AppError(401, "No refresh token");

      const result = await authService.refresh(token);
      res.cookie("refreshToken", result.refreshToken, refreshCookieOptions);
      res.json({ accessToken: result.accessToken });
    } catch (err) {
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      next(err);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies.refreshToken;
      if (token) await authService.logout(token);
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      res.json({ message: "Logged out" });
    } catch (err) {
      next(err);
    }
  },

  async logoutAll(req: Request, res: Response, next: NextFunction) {
    try {
      await authService.logoutAll(req.user!.id);
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
