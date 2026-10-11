import type { NextFunction, Request, Response } from "express";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";

export async function requirePlatformAdmin(_req: Request, _res: Response, next: NextFunction) {
  try { await requirePlatformAuthority(); next(); }
  catch (error) { next(error); }
}
