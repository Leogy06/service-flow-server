import { organizationService } from "./organization.service";
import { sendResponse } from "@/utils/sendResponse";
import { NextFunction, Request, Response } from "express";
import type {
  OrganizationInput,
  RequestSubscriptionUpgradeInput,
} from "./organization.schema";
import { subscriptionUpgradeService } from "./subscription-upgrade.service";

export const organizationController = {
  async requestUpgrade(req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        201,
        "Upgrade requested successfully",
        await subscriptionUpgradeService.request(
          req.validated.body as RequestSubscriptionUpgradeInput,
        ),
      );
    } catch (err) {
      next(err);
    }
  },

  async upgradePlans(_req: Request, res: Response, next: NextFunction) {
    try {
      sendResponse(
        res,
        200,
        "Upgrade plans fetched successfully",
        await subscriptionUpgradeService.plans(),
      );
    } catch (err) {
      next(err);
    }
  },

  async subscription(_req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await organizationService.subscription();
      sendResponse(res, 200, "Subscription fetched successfully", summary);
    } catch (err) {
      next(err);
    }
  },

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
      const organization = await organizationService.create(
        req.validated.body as OrganizationInput,
      );
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
