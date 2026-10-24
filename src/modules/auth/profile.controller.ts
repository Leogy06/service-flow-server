import type { Request, Response, NextFunction } from "express";
import { sendResponse } from "@/utils/sendResponse";
import { profileService } from "./profile.service";
import type { ChangePasswordInput, UpdateProfileInput } from "./profile.schema";
import { clearTrustedDeviceCookies } from "./trusted-device.controller";

export const profileController = {
  async get(_req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Profile fetched successfully",
        await profileService.get(),
      );
    } catch (error) {
      next(error);
    }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Profile updated successfully",
        await profileService.update(req.validated.body as UpdateProfileInput),
      );
    } catch (error) {
      next(error);
    }
  },
  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await profileService.changePassword(
        req.validated.body as ChangePasswordInput,
      );
      res.clearCookie("refreshToken", { path: "/api/auth" });
      res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
      clearTrustedDeviceCookies(res);
      sendResponse(
        res,
        200,
        "Password changed. Sign in again with your new password",
        result,
      );
    } catch (error) {
      next(error);
    }
  },
};
