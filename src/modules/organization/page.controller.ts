import type { Request, Response, NextFunction } from "express";
import { sendResponse } from "@/utils/sendResponse";
import { organizationPageService } from "./page.service";
import type { PageUpdateInput, PublicPageParams } from "./page.schema";

export const organizationPageController = {
  async get(_req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "Business page fetched", await organizationPageService.get()); } catch (error) { next(error); }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "Business page updated", await organizationPageService.update(req.validated.body as PageUpdateInput)); } catch (error) { next(error); }
  },
  async publicPage(req: Request, res: Response, next: NextFunction) {
    try { sendResponse(res, 200, "Business page fetched", await organizationPageService.publicPage((req.validated.params as PublicPageParams).slug)); } catch (error) { next(error); }
  },
};
