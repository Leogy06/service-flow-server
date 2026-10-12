import { Router } from "express";
import { validate } from "@/middleware/validate.js";
import { auditController } from "./audit.controller.js";
import { listAuditLogsSchema } from "./audit.schema.js";

const auditRoutes = Router();
auditRoutes.get("/", validate(listAuditLogsSchema), auditController.list);
export default auditRoutes;
