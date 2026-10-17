import {
  CreateCustomerSchema,
  UpdateCustomerInput,
  CustomerParams,
} from "./customer.schema";
import { CustomerListInput } from "./customer.schema";
import { customerService } from "./customer.service";
import { sendResponse } from "@/utils/sendResponse";
import { NextFunction, Request, Response } from "express";

export const customerController = {
  create: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customer = await customerService.create(
        req.validated.body as CreateCustomerSchema,
      );
      sendResponse(res, 201, "Customer created successfully", customer);
    } catch (error) {
      next(error);
    }
  },

  list: async (req: Request, res: Response, next: NextFunction) => {
    const { page, pageSize, sortBy, sortOrder, search, filter, deleted } = req
      .validated.query as CustomerListInput["query"];

    try {
      const customers = await customerService.list(
        page,
        pageSize,
        search,
        sortOrder,
        sortBy,
        filter,
        deleted,
      );
      sendResponse(res, 200, "Customers fetched successfully", customers);
    } catch (error) {
      next(error);
    }
  },

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.validated.params as CustomerParams;
      const customer = await customerService.get(id);
      sendResponse(res, 200, "Customer fetched successfully", customer);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const validated = req.validated.body as UpdateCustomerInput;
      const { id } = req.validated.params as CustomerParams;
      const customer = await customerService.update(id, validated);
      sendResponse(res, 200, "Customer updated successfully", customer);
    } catch (err) {
      next(err);
    }
  },

  async restore(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.validated.params as CustomerParams;
      const customer = await customerService.restore(id);
      sendResponse(res, 200, "Customer restored successfully", customer);
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.validated.params as CustomerParams;
      const customer = await customerService.delete(id);
      sendResponse(res, 200, "Customer deleted successfully", customer);
    } catch (err) {
      next(err);
    }
  },
};

export default customerController;
