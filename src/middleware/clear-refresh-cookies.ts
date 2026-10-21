import type { RequestHandler, Response } from "express";

export function clearRefreshCookies(res: Response): void {
  if (res.locals.refreshCookiesCleared === true) return;
  res.clearCookie("refreshToken", { path: "/api/auth" });
  res.clearCookie("refreshToken", { path: "/api/auth/refresh" });
  res.locals.refreshCookiesCleared = true;
}

// Cookie clearing remains available even when the revocation budget/store rejects.
export const clearLogoutCookies: RequestHandler = (_req, res, next) => {
  clearRefreshCookies(res);
  next();
};
