import { Router, raw, type RequestHandler } from "express";
import { authenticate } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { brandingAssetLimiter, brandingUploadLimiter, writeLimmiter } from "@/middleware/rateLimiter";
import { AppError } from "@/utils/AppError";
import { brandingController } from "./branding.controller";
import { requireBrandingTenant } from "./branding.service";
import { brandingAssetSchema, brandingReadSchema, brandingUpdateSchema } from "./branding.schema";
import { BRANDING_MAX_BYTES } from "./branding-assets";

const tenant: RequestHandler = (_req, _res, next) => { try { requireBrandingTenant(); next(); } catch (error) { next(error); } };
const tenantAdmin: RequestHandler = (_req, _res, next) => { try { requireBrandingTenant(true); next(); } catch (error) { next(error); } };
const parseImage = raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: BRANDING_MAX_BYTES, inflate: false });
const imageBody: RequestHandler = (req, res, next) => {
  parseImage(req, res, (error: unknown) => {
    if (error) {
      const status = typeof error === "object" && "status" in error ? error.status : undefined;
      next(new AppError(status === 413 ? 413 : 400, status === 413 ? "Image must be 256 KB or smaller" : "Invalid image request"));
    } else next();
  });
};
export const brandingRoutes = Router();
brandingRoutes.get("/branding-assets/:filename", brandingAssetLimiter, validate(brandingAssetSchema), brandingController.asset);
brandingRoutes.get("/settings", authenticate, tenant, validate(brandingReadSchema), brandingController.get);
brandingRoutes.patch("/settings", authenticate, tenantAdmin, writeLimmiter, validate(brandingUpdateSchema), brandingController.update);
for (const kind of ["logo", "favicon"] as const) {
  brandingRoutes.post(`/settings/${kind}`, authenticate, tenantAdmin, writeLimmiter, brandingUploadLimiter, validate(brandingReadSchema), imageBody, brandingController.upload(kind));
  brandingRoutes.delete(`/settings/${kind}`, authenticate, tenantAdmin, writeLimmiter, validate(brandingReadSchema), brandingController.remove(kind));
}
