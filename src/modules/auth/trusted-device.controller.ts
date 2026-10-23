import type { NextFunction, Request, Response } from "express";
import { env } from "@/config/env";
import { sendResponse } from "@/utils/sendResponse";
import { trustedDeviceService, type TrustedDeviceCookies } from "./trusted-device.service";

const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/auth" };

function trustedCookies(req: Request): TrustedDeviceCookies {
  return {
    trustedDeviceTenant: typeof req.cookies?.trustedDeviceTenant === "string" ? req.cookies.trustedDeviceTenant : undefined,
    trustedDeviceAdmin: typeof req.cookies?.trustedDeviceAdmin === "string" ? req.cookies.trustedDeviceAdmin : undefined,
  };
}

export function clearTrustedDeviceCookies(res: Response) {
  res.clearCookie("trustedDeviceTenant", cookieOptions);
  res.clearCookie("trustedDeviceAdmin", cookieOptions);
}

export const trustedDeviceController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(res, 200, "Trusted devices fetched successfully", await trustedDeviceService.list(trustedCookies(req)));
    } catch (error) { next(error); }
  },
  async revoke(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.validated.params as { id: string };
      const { clearSurface, ...result } = await trustedDeviceService.revoke(id, trustedCookies(req));
      if (clearSurface) res.clearCookie(clearSurface === "system-admin" ? "trustedDeviceAdmin" : "trustedDeviceTenant", cookieOptions);
      sendResponse(res, 200, "Trusted device revoked", result);
    } catch (error) { next(error); }
  },
  async revokeAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await trustedDeviceService.revokeAll();
      clearTrustedDeviceCookies(res);
      sendResponse(res, 200, "All trusted devices revoked", result);
    } catch (error) { next(error); }
  },
};
