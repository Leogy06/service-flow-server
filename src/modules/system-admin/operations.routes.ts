import { Router, type Request, type RequestHandler } from "express";
import { validate } from "@/middleware/validate.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { operationsService, processPlatformAlerts } from "./operations.service.js";
import { alertListSchema, alertProcessSchema, alertReadSchema, dateWindowSchema, settingsSchema, type AlertListQuery, type SettingsInput } from "./operations.schema.js";
import { platformTransaction, recordPlatformAudit } from "./platform-audit.js";
import { requirePlatformAuthority } from "@/modules/role/tenant-access-policy.js";
const routes = Router();
const handle = (work: (req: Request) => Promise<unknown>): RequestHandler => async (req, res, next) => {
  try { sendResponse(res, 200, "Platform request completed", await work(req)); } catch (error) { next(error); }
};
routes.get("/dashboard", validate(dateWindowSchema), handle((r) => operationsService.dashboard(r.validated.query as { from?: string; to?: string })));
routes.get("/monitoring", handle(() => operationsService.monitoring()));
routes.get("/settings", handle(() => operationsService.settings()));
routes.patch("/settings", writeLimmiter, validate(settingsSchema), handle((r) => operationsService.updateSettings(r.validated.body as SettingsInput)));
routes.get("/alerts", validate(alertListSchema), handle((r) => operationsService.alerts(r.validated.query as AlertListQuery)));
routes.patch("/alerts/:id/read", writeLimmiter, validate(alertReadSchema), handle((r) => operationsService.readAlert((r.validated.params as { id: string }).id, (r.validated.body as { reason: string }).reason)));
routes.post("/alerts/process", writeLimmiter, validate(alertProcessSchema), handle(async (r) => {
  const body = r.validated.body as { reason: string; cursor?: string };
  await platformTransaction(async (db) => { await requirePlatformAuthority(db); await recordPlatformAudit(db, { action: "platform.alerts.process", entity: "Platform", entityId: "scheduler", after: { reason: body.reason } }); });
  return processPlatformAlerts(body.cursor);
}));
routes.get("/reports/billing", validate(dateWindowSchema), async (req, res, next) => {
  try {
    const report = await operationsService.billingReport(req.validated.query as { from?: string; to?: string });
    res.setHeader("Content-Disposition", `attachment; filename="${report.filename}"`);
    res.setHeader("Cache-Control", "no-store"); res.type("text/csv").send(report.csv);
  } catch (error) { next(error); }
});
export default routes;
