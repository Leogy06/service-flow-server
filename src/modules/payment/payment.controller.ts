import type { RequestHandler } from "express";
import { sendResponse } from "@/utils/sendResponse";
import { paymentService } from "./payment.service";
import type { RecordPayment } from "./payment.schema";

export const recordPayment: RequestHandler = async (req, res, next) => {
  try {
    const result = await paymentService.record(
      (req.validated.params as { id: string }).id,
      req.validated.body as RecordPayment,
    );
    sendResponse(res, result.replayed ? 200 : 201, "Payment recorded", result);
  } catch (error) {
    next(error);
  }
};
