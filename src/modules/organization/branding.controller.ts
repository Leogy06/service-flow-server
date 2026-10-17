import type { NextFunction, Request, Response } from "express";
import { sendResponse } from "@/utils/sendResponse";
import { AppError } from "@/utils/AppError";
import { brandingService } from "./branding.service";
import type { BrandingUpdateInput } from "./branding.schema";
import type { BrandingAssetKind } from "./branding-assets";

export const brandingController = {
  async get(_req: Request, res: Response, next: NextFunction) {
    try { res.setHeader("Cache-Control", "no-store"); sendResponse(res, 200, "Organization settings fetched successfully", await brandingService.get()); } catch (error) { next(error); }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try { res.setHeader("Cache-Control", "no-store"); sendResponse(res, 200, "Organization settings updated successfully", await brandingService.update(req.validated.body as BrandingUpdateInput)); } catch (error) { next(error); }
  },
  upload(kind: BrandingAssetKind) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!Buffer.isBuffer(req.body)) throw new AppError(415, "Send the image file as the request body");
        res.setHeader("Cache-Control", "no-store");
        sendResponse(res, 200, "Branding image uploaded successfully", await brandingService.upload(kind, req.body, req.headers["content-type"] ?? ""));
      } catch (error) { next(error); }
    };
  },
  remove(kind: BrandingAssetKind) {
    return async (_req: Request, res: Response, next: NextFunction) => {
      try { res.setHeader("Cache-Control", "no-store"); sendResponse(res, 200, "Branding image removed successfully", await brandingService.remove(kind)); } catch (error) { next(error); }
    };
  },
  async asset(req: Request, res: Response, next: NextFunction) {
    try {
      const image = await brandingService.asset(req.params.filename as string);
      res.set({ "Content-Type": image.contentType, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "public, max-age=31536000, immutable", "Cross-Origin-Resource-Policy": "cross-origin" });
      res.send(image.data);
    } catch (error) { next(error); }
  },
};
