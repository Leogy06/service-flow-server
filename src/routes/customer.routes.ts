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
