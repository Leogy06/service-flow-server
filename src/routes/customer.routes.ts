import { customerController } from "@/controllers/customer.controller.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { requirePermission } from "@/middleware/require-permission.js";
import { validate } from "@/middleware/validate.js";
import {
  createCustomerSchema,
  customerListInput,
} from "@/schemas/customer.schema.js";
import { Router } from "express";
import { PERMISSIONS } from "@/constants/permission.constants.js";

export const customerRoutes = Router();

customerRoutes.post(
  "/",
  writeLimmiter,
  validate(createCustomerSchema),
  requirePermission(PERMISSIONS.CUSTOMER_CREATE),
  customerController.create,
);

customerRoutes.get(
  "/",
  validate(customerListInput),
  requirePermission(PERMISSIONS.CUSTOMER_READ),
  customerController.list,
);
