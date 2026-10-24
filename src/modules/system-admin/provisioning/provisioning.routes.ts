import { Router, type Request, type Response, type NextFunction } from "express";
import { validate } from "@/middleware/validate";
import { writeLimmiter } from "@/middleware/rateLimiter";
import { sendResponse } from "@/utils/sendResponse";
import { provisioningService } from "./provisioning.service";
import {
  provisioningCreateSchema, provisioningDetailSchema, provisioningActionSchema, provisioningTemplatesSchema, provisioningTemplateSchema,
  type ProvisioningInput, type ProvisioningActionInput,
} from "./provisioning.schema";
import type { IndustryId } from "./templates";

// Parent system-admin router supplies authenticate, apiLimiter and persisted platform authority.
const router = Router();
const handle = (work: (req: Request) => Promise<unknown>, message: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { sendResponse(res, 200, message, await work(req)); } catch (error) { next(error); }
  };
const id = (req: Request) => (req.validated.params as { id: string }).id;
router.get("/provisioning/templates", validate(provisioningTemplatesSchema), handle(() => provisioningService.templates(), "Industry templates fetched"));
router.get("/provisioning/templates/:templateId", validate(provisioningTemplateSchema),
  handle((req) => provisioningService.template((req.validated.params as { templateId: IndustryId }).templateId), "Industry template fetched"));
router.post("/provisioning", writeLimmiter, validate(provisioningCreateSchema),
  handle((req) => provisioningService.create(req.validated.body as ProvisioningInput), "Workspace provisioned"));
router.get("/provisioning/:id", validate(provisioningDetailSchema), handle((req) => provisioningService.get(id(req)), "Provisioning status fetched"));
router.post("/provisioning/:id/invitation", writeLimmiter, validate(provisioningActionSchema),
  handle((req) => provisioningService.resendInvitation(id(req), req.validated.body as ProvisioningActionInput), "Owner invitation processed"));
router.post("/provisioning/:id/reset-demo", writeLimmiter, validate(provisioningActionSchema),
  handle((req) => provisioningService.resetDemo(id(req), req.validated.body as ProvisioningActionInput), "Demo samples reset"));
export default router;
