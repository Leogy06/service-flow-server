import { customerController } from "./customer.controller.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { validate } from "@/middleware/validate.js";
import {
  createCustomerSchema,
  customerListInput,
  customerParamsSchema,
  updateCustomerInput,
} from "./customer.schema.js";
import { Router } from "express";
import { PERMISSIONS } from "@/constants/permission.constants.js";

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

customerRoutes.delete(
  "/:id",
  writeLimmiter,
  requirePermission(PERMISSIONS.CUSTOMER_DELETE),
  validate(customerParamsSchema),
  customerController.delete,
);
export default customerRoutes;
