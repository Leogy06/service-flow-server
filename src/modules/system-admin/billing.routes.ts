import { Router, type Request, type Response, type NextFunction } from "express";
import { validate } from "@/middleware/validate.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { billingService as service } from "./billing.service.js";
import { planListSchema, subscriptionListSchema, paymentListSchema, billingDetailSchema, createPlanSchema, updatePlanSchema,
  assignSubscriptionSchema, changePlanSchema, changeSubscriptionStatusSchema, recordPaymentSchema, reviewPaymentSchema, refundPaymentSchema,
  type PlanListQuery, type SubscriptionListQuery, type PaymentListQuery, type CreatePlanInput, type UpdatePlanInput,
  type AssignSubscriptionInput, type ChangePlanInput, type ChangeStatusInput, type RecordPaymentInput, type ReviewPaymentInput, type RefundPaymentInput } from "./billing.schema.js";
const router = Router();
const handle = (work: (req: Request) => Promise<unknown>, message: string, status = 200) => async (req: Request, res: Response, next: NextFunction) => {
  try { sendResponse(res, status, message, await work(req)); } catch (error) { next(error); }
};
const id = (req: Request) => (req.validated.params as { id: string }).id;
router.get("/plans", validate(planListSchema), handle((req) => service.listPlans(req.validated.query as PlanListQuery), "Plans fetched"));
router.post("/plans", writeLimmiter, validate(createPlanSchema), handle((req) => service.createPlan(req.validated.body as CreatePlanInput), "Plan created", 201));
router.patch("/plans/:id", writeLimmiter, validate(updatePlanSchema), handle((req) => service.updatePlan(id(req), req.validated.body as UpdatePlanInput), "Plan updated"));
router.get("/subscriptions", validate(subscriptionListSchema), handle((req) => service.listSubscriptions(req.validated.query as SubscriptionListQuery), "Subscriptions fetched"));
router.get("/subscriptions/:id", validate(billingDetailSchema), handle((req) => service.subscription(id(req)), "Subscription fetched"));
router.post("/subscriptions", writeLimmiter, validate(assignSubscriptionSchema), handle((req) => service.assignSubscription(req.validated.body as AssignSubscriptionInput), "Subscription assigned", 201));
router.post("/subscriptions/:id/plan", writeLimmiter, validate(changePlanSchema), handle((req) => service.changePlan(id(req), req.validated.body as ChangePlanInput), "Subscription plan updated"));
router.post("/subscriptions/:id/status", writeLimmiter, validate(changeSubscriptionStatusSchema), handle((req) => service.changeStatus(id(req), req.validated.body as ChangeStatusInput), "Subscription status updated"));
router.get("/payments", validate(paymentListSchema), handle((req) => service.listPayments(req.validated.query as PaymentListQuery), "Payments fetched"));
router.get("/payments/:id", validate(billingDetailSchema), handle((req) => service.payment(id(req)), "Payment fetched"));
router.post("/payments", writeLimmiter, validate(recordPaymentSchema), handle((req) => service.recordPayment(req.validated.body as RecordPaymentInput), "Payment recorded", 201));
router.post("/payments/:id/review", writeLimmiter, validate(reviewPaymentSchema), handle((req) => service.reviewPayment(id(req), req.validated.body as ReviewPaymentInput), "Payment reviewed"));
router.post("/payments/:id/refund", writeLimmiter, validate(refundPaymentSchema), handle((req) => service.refundPayment(id(req), req.validated.body as RefundPaymentInput), "Payment refunded"));
export default router;
