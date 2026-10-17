import type { RequestHandler } from "express";
import { sendResponse } from "@/utils/sendResponse";
import { dashboardService } from "./dashboard.service";

export const getDashboard: RequestHandler = async (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    sendResponse(res, 200, "Dashboard fetched", await dashboardService.get());
  } catch (error) {
    next(error);
  }
};
