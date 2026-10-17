import type { Request, RequestHandler } from "express";
import { sendResponse } from "@/utils/sendResponse";
import { feedbackService as service } from "./feedback.service";
import type { ProductInput, PublicSubmitInput, FeedbackList, ReviewInput } from "./feedback.schema";

function handler(work: (req: Request) => Promise<unknown>, message: string): RequestHandler {
  return async (req, res, next) => {
    try { sendResponse(res, 200, message, await work(req)); } catch (error) { next(error); }
  };
}
const id = (req: Request) => (req.validated.params as { id: string }).id;
const token = (req: Request) => (req.validated.body as { token: string }).token;
export const feedbackController = {
  submitProduct: handler((req) => service.submitProduct(req.validated.body as ProductInput), "Feedback submitted"),
  mine: handler((req) => service.mine(req.validated.query as FeedbackList), "Your feedback fetched"),
  listProduct: handler((req) => service.listProduct(req.validated.query as FeedbackList), "Product feedback fetched"),
  listCustomer: handler((req) => service.listCustomer(req.validated.query as FeedbackList), "Customer feedback fetched"),
  reviewProduct: handler((req) => service.reviewProduct(id(req), req.validated.body as ReviewInput), "Feedback reviewed"),
  reviewCustomer: handler((req) => service.reviewCustomer(id(req), req.validated.body as ReviewInput), "Feedback reviewed"),
  withdrawProduct: handler((req) => service.withdrawProduct(id(req)), "Publication permission withdrawn"),
  createInvitation: handler((req) => service.createInvitation((req.validated.body as { serviceRequestId: string }).serviceRequestId), "Feedback link created"),
  publicContext: handler((req) => service.publicContext(token(req)), "Feedback form fetched"),
  submitCustomer: handler((req) => service.submitCustomer(req.validated.body as PublicSubmitInput), "Feedback submitted"),
  withdrawCustomer: handler((req) => service.withdrawCustomer(token(req)), "Publication permission withdrawn"),
};
