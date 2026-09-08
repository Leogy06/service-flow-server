import { customerController } from "@/controllers/customer.controller.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { validate } from "@/middleware/validate.js";
import {
  createCustomerSchema,
  customerListInput,
  updateCustomerParamsSchema,
  updateCustomerSchema,
} from "@/schemas/customer.schema.js";
import { Router } from "express";
import { PERMISSIONS } from "@/constants/permission.constants.js";

export const customerRoutes = Router();

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

customerRoutes.put(
  "/:id",
  writeLimmiter,
  requirePermission(PERMISSIONS.CUSTOMER_UPDATE),
  validate(updateCustomerParamsSchema),
  validate(updateCustomerSchema),
  customerController.update,
);

customerRoutes.delete(
  "/:id",
  requirePermission(PERMISSIONS.CUSTOMER_DELETE),
  customerController.delete,
);
