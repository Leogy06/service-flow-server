import { CreateCustomerInput } from "@/schemas/customer.schema.js";
import { customerService } from "@/services/customer.service.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { NextFunction, Request, Response } from "express";

export const customerController = {
  create: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customer = await customerService.create(
        req.body as CreateCustomerInput,
      );
      sendResponse(res, 201, "Customer created successfully", customer);
    } catch (error) {
      next(error);
    }
  },
};
