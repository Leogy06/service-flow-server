import { customerController } from "@/controllers/customer.controller.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { validate } from "@/middleware/validate.js";
import {
  createCustomerSchema,
  customerListInput,
} from "@/schemas/customer.schema.js";
import { Router } from "express";

export const customerRoutes = Router();

customerRoutes.post(
  "/",
  writeLimmiter,
  validate(createCustomerSchema),
  customerController.create,
);

customerRoutes.get("/", validate(customerListInput), customerController.list);
