import { Router } from "express";
import { PERMISSIONS as P } from "@/constants/permission.constants";
import { requirePermission } from "@/middleware/require-permission";
import { writeLimmiter } from "@/middleware/rateLimiter";
import { validate } from "@/middleware/validate";
import { jobController as c } from "./job.controller";
import {
  jobListInput,
  jobCountsInput,
  jobFiltersInput,
  staffListInput,
  resourceParams,
  createJobInput,
  updateJobInput,
  jobStatusInput,
  cancelJobInput,
} from "./job.schema";

const routes = Router();
routes.get("/counts", requirePermission(P.JOB_READ), validate(jobCountsInput), c.counts);
routes.get("/", requirePermission(P.JOB_READ), validate(jobListInput), c.list);
routes.get(
  "/filters",
  requirePermission(P.JOB_READ),
  validate(jobFiltersInput),
  c.filters,
);
// Both creation and reassignment need this minimal staff picker.
routes.get(
  "/staff",
  (req, res, next) => {
    if (
      req.user?.permissions?.includes(P.JOB_CREATE) ||
      req.user?.permissions?.includes(P.JOB_UPDATE)
    )
      return next();
    return requirePermission(P.JOB_CREATE)(req, res, next);
  },
  validate(staffListInput),
  c.staff,
);
routes.get(
  "/:id",
  requirePermission(P.JOB_READ),
  validate(resourceParams),
  c.get,
);
routes.post(
  "/",
  writeLimmiter,
  requirePermission(P.JOB_CREATE),
  validate(createJobInput),
  c.create,
);
routes.put(
  "/:id",
  writeLimmiter,
  requirePermission(P.JOB_UPDATE),
  validate(updateJobInput),
  c.update,
);
routes.patch(
  "/:id/status",
  writeLimmiter,
  requirePermission(P.JOB_UPDATE),
  validate(jobStatusInput),
  c.status,
);
routes.post(
  "/:id/cancel",
  writeLimmiter,
  requirePermission(P.JOB_DELETE),
  validate(cancelJobInput),
  c.cancel,
);
export default routes;
