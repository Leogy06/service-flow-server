import { Router } from "express";
import { PERMISSIONS as P } from "@/constants/permission.constants";
import { requirePermission } from "@/middleware/require-permission";
import { writeLimmiter } from "@/middleware/rateLimiter";
import { validate } from "@/middleware/validate";
import { serviceRequestController as c } from "./service-request.controller";
import {
  createRequestInput,
  updateRequestInput,
  requestListInput,
  requestParamsInput,
  statusInput,
  customerOptionsInput,
  typeListInput,
  createTypeInput,
  updateTypeInput,
} from "./service-request.schema";

const routes = Router();
routes.get(
  "/",
  requirePermission(P.SERVICE_REQUEST_READ),
  validate(requestListInput),
  c.list,
);
// Minimal customer options are part of request creation, without exposing customer contact details.
routes.get(
  "/customers",
  requirePermission(P.SERVICE_REQUEST_CREATE),
  validate(customerOptionsInput),
  c.customers,
);
routes.get(
  "/types",
  requirePermission(P.SERVICE_REQUEST_READ),
  validate(typeListInput),
  c.types,
);
routes.post(
  "/types",
  writeLimmiter,
  requirePermission(P.SERVICE_REQUEST_CREATE),
  validate(createTypeInput),
  c.createType,
);
routes.put(
  "/types/:id",
  writeLimmiter,
  requirePermission(P.SERVICE_REQUEST_UPDATE),
  validate(updateTypeInput),
  c.updateType,
);
routes.delete(
  "/types/:id",
  writeLimmiter,
  requirePermission(P.SERVICE_REQUEST_DELETE),
  validate(requestParamsInput),
  c.archiveType,
);
routes.post(
  "/",
  writeLimmiter,
  requirePermission(P.SERVICE_REQUEST_CREATE),
  validate(createRequestInput),
  c.create,
);
routes.get(
  "/:id",
  requirePermission(P.SERVICE_REQUEST_READ),
  validate(requestParamsInput),
  c.get,
);
routes.put(
  "/:id",
  writeLimmiter,
  requirePermission(P.SERVICE_REQUEST_UPDATE),
  validate(updateRequestInput),
  c.update,
);
routes.patch(
  "/:id/status",
  writeLimmiter,
  requirePermission(P.SERVICE_REQUEST_UPDATE),
  validate(statusInput),
  c.status,
);
export default routes;
