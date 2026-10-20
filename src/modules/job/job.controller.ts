import type { RequestHandler } from "express";
import { sendResponse } from "@/utils/sendResponse";
import { jobService } from "./job.service";
import type { CreateJob, UpdateJob, JobList, JobFilters } from "./job.schema";

export const jobController: Record<string, RequestHandler> = {
  filters: async (req, res, next) => {
    try {
      sendResponse(
        res,
        200,
        "Job filters fetched",
        await jobService.filters(req.validated.query as JobFilters),
      );
    } catch (error) {
      next(error);
    }
  },
  list: async (req, res, next) => {
    try {
      sendResponse(
        res,
        200,
        "Jobs fetched",
        await jobService.list(req.validated.query as JobList),
      );
    } catch (error) {
      next(error);
    }
  },
  staff: async (req, res, next) => {
    try {
      sendResponse(
        res,
        200,
        "Available staff fetched",
        await jobService.staff(
          req.validated.query as {
            page: number;
            pageSize: number;
            search: string;
          },
        ),
      );
    } catch (error) {
      next(error);
    }
  },
  get: async (req, res, next) => {
    try {
      sendResponse(
        res,
        200,
        "Job fetched",
        await jobService.get((req.validated.params as { id: string }).id),
      );
    } catch (error) {
      next(error);
    }
  },
  create: async (req, res, next) => {
    try {
      sendResponse(
        res,
        201,
        "Job created",
        await jobService.create(req.validated.body as CreateJob),
      );
    } catch (error) {
      next(error);
    }
  },
  update: async (req, res, next) => {
    try {
      sendResponse(
        res,
        200,
        "Job updated",
        await jobService.update(
          (req.validated.params as { id: string }).id,
          req.validated.body as UpdateJob,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
  status: async (req, res, next) => {
    const body = req.validated.body as {
      status: "IN_PROGRESS" | "COMPLETED";
      note: string;
      overrideStaffConflict?: boolean;
    };
    try {
      sendResponse(
        res,
        200,
        "Job status updated",
        await jobService.status(
          (req.validated.params as { id: string }).id,
          body.status,
          body.note,
          body.overrideStaffConflict,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
  cancel: async (req, res, next) => {
    try {
      sendResponse(
        res,
        200,
        "Job cancelled",
        await jobService.status(
          (req.validated.params as { id: string }).id,
          "CANCELLED",
          (req.validated.body as { note: string }).note,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
};
