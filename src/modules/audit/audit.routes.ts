import { Router } from "express";
import { validate } from "@/middleware/validate";
import { auditController } from "./audit.controller";
import { listAuditLogsSchema } from "./audit.schema";

const auditRoutes = Router();
auditRoutes.get("/", validate(listAuditLogsSchema), auditController.list);
export default auditRoutes;
