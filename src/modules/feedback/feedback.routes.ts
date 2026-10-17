import { Router } from "express";
import { authenticate } from "@/middleware/auth";
import { requireSystemAdmin } from "@/middleware/require-platform-admin";
import { requirePermission } from "@/middleware/require-permission";
import { feedbackLimiter, writeLimmiter } from "@/middleware/rateLimiter";
import { validate } from "@/middleware/validate";
import { tenantOrganization } from "@/utils/tenant-transaction";
import { PERMISSIONS as P } from "@/constants/permission.constants";
import { feedbackController as c } from "./feedback.controller";
import { productInput, publicSubmitInput, publicTokenInput, invitationInput, feedbackIdInput, reviewInput, listInput } from "./feedback.schema";

function privateRouter() {
  const routes = Router();
  routes.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  return routes;
}
export const tenantFeedbackRoutes = privateRouter();
tenantFeedbackRoutes.use(authenticate, (_req, _res, next) => {
  try { tenantOrganization(); next(); } catch (error) { next(error); }
});
tenantFeedbackRoutes.post("/product", writeLimmiter, validate(productInput), c.submitProduct);
tenantFeedbackRoutes.get("/product/mine", validate(listInput), c.mine);
tenantFeedbackRoutes.post("/product/:id/withdraw-consent", writeLimmiter, validate(feedbackIdInput), c.withdrawProduct);
tenantFeedbackRoutes.get("/customers", requirePermission(P.FEEDBACK_READ), validate(listInput), c.listCustomer);
tenantFeedbackRoutes.patch("/customers/:id", writeLimmiter, requirePermission(P.FEEDBACK_READ), requirePermission(P.FEEDBACK_UPDATE), validate(reviewInput), c.reviewCustomer);
tenantFeedbackRoutes.post("/invitations", writeLimmiter, requirePermission(P.FEEDBACK_CREATE), requirePermission(P.SERVICE_REQUEST_READ), validate(invitationInput), c.createInvitation);

export const platformFeedbackRoutes = privateRouter();
platformFeedbackRoutes.use(authenticate, requireSystemAdmin);
platformFeedbackRoutes.get("/", validate(listInput), c.listProduct);
platformFeedbackRoutes.patch("/:id", writeLimmiter, validate(reviewInput), c.reviewProduct);

export const publicFeedbackRoutes = privateRouter();
publicFeedbackRoutes.use(feedbackLimiter);
// Tokens stay in POST bodies so request URLs and referer headers cannot disclose them.
publicFeedbackRoutes.post("/context", validate(publicTokenInput), c.publicContext);
publicFeedbackRoutes.post("/submit", writeLimmiter, validate(publicSubmitInput), c.submitCustomer);
publicFeedbackRoutes.post("/withdraw-consent", writeLimmiter, validate(publicTokenInput), c.withdrawCustomer);
