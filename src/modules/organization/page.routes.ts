import { Router, type RequestHandler } from "express";
import { authenticate } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { publicPageLimiter, writeLimmiter } from "@/middleware/rateLimiter";
import { requireBrandingTenant } from "./branding.service";
import { organizationPageController } from "./page.controller";
import { pageReadSchema, pageUpdateSchema, publicPageSchema } from "./page.schema";

const tenantAdmin: RequestHandler = (_req, _res, next) => { try { requireBrandingTenant(true); next(); } catch (error) { next(error); } };
export const organizationPageRoutes = Router();
organizationPageRoutes.use(["/page", "/public-page"], (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
organizationPageRoutes.get("/public-page/:slug", publicPageLimiter, validate(publicPageSchema), organizationPageController.publicPage);
organizationPageRoutes.get("/page", authenticate, tenantAdmin, validate(pageReadSchema), organizationPageController.get);
organizationPageRoutes.put("/page", authenticate, tenantAdmin, writeLimmiter, validate(pageUpdateSchema), organizationPageController.update);
