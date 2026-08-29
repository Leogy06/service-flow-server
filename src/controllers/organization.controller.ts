import { organizationService } from "@/services/organization.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { NextFunction, Request, Response } from "express";

export const organizationController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const organizations = await organizationService.list();
      sendResponse(
        res,
        200,
        "Organizations fetched successfully",
        organizations,
      );
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const organization = await organizationService.create(req.body);
      sendResponse(res, 201, "Organization created successfully", organization);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const organization = await organizationService.getById(
        req.params.id as string,
      );
      sendResponse(res, 200, "Organization fetched successfully", organization);
    } catch (err) {
      next(err);
    }
  },

  async checkSlug(req: Request, res: Response, next: NextFunction) {
    try {
      const organization = await organizationService.checkSlug(
        req.params.slug as string,
      );
      sendResponse(res, 200, "Organization fetched successfully", organization);
    } catch (err) {
      next(err);
    }
  },
};
