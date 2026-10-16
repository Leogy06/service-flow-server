import { Router, type Request, type Response, type NextFunction } from "express";
import { validate } from "@/middleware/validate.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { signupService } from "./signup.service.js";
import { signupListSchema, signupCountSchema, signupReviewSchema, type SignupListQuery, type SignupReviewInput } from "./signup.schema.js";

const router = Router();
const handle = (work: (req: Request) => Promise<unknown>, message: string) => async (req: Request, res: Response, next: NextFunction) => {
  try { sendResponse(res, 200, message, await work(req)); } catch (error) { next(error); }
};
router.get("/signup-requests/count", validate(signupCountSchema), handle(() => signupService.count(), "Pending signups counted"));
router.get("/signup-requests", validate(signupListSchema), handle((req) => signupService.list(req.validated.query as SignupListQuery), "Signup requests fetched"));
router.post("/signup-requests/:id/review", writeLimmiter, validate(signupReviewSchema), handle((req) => signupService.review(
  (req.validated.params as { id: string }).id, req.validated.body as SignupReviewInput,
), "Signup request reviewed"));
export default router;
