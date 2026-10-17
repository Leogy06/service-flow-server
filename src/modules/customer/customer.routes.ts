import { customerController } from "./customer.controller";
import { writeLimmiter } from "@/middleware/rateLimiter";
import { requirePermission } from "@/middleware/require-permission";
import { validate } from "@/middleware/validate";
import {
  createCustomerSchema,
  customerListInput,
  customerParamsSchema,
  updateCustomerInput,
} from "./customer.schema";
import { Router } from "express";
import { PERMISSIONS } from "@/constants/permission.constants";

const customerRoutes = Router();

customerRoutes.post(
  "/",
  writeLimmiter,
  requirePermission(PERMISSIONS.CUSTOMER_CREATE),
  validate(createCustomerSchema),
  customerController.create,
);

customerRoutes.get(
  "/",
  requirePermission(PERMISSIONS.CUSTOMER_READ),
  validate(customerListInput),
  customerController.list,
);

customerRoutes.get(
  "/:id",
  requirePermission(PERMISSIONS.CUSTOMER_READ),
  validate(customerParamsSchema),
  customerController.get,
);

customerRoutes.put(
  "/:id",
  writeLimmiter,
  requirePermission(PERMISSIONS.CUSTOMER_UPDATE),
  validate(updateCustomerInput),
  customerController.update,
);

customerRoutes.patch(
  "/:id/restore",
  writeLimmiter,
  requirePermission(PERMISSIONS.CUSTOMER_UPDATE),
  validate(customerParamsSchema),
  customerController.restore,
);

customerRoutes.delete(
  "/:id",
  writeLimmiter,
  requirePermission(PERMISSIONS.CUSTOMER_DELETE),
  validate(customerParamsSchema),
  customerController.delete,
);
export default customerRoutes;
