import { Router } from "express";
import { PERMISSIONS as P } from "@/constants/permission.constants";
import { requirePermission } from "@/middleware/require-permission";
import { writeLimmiter } from "@/middleware/rateLimiter";
import { validate } from "@/middleware/validate";
import { resourceParams } from "@/modules/job/job.schema";
import { recordPaymentInput } from "@/modules/payment/payment.schema";
import { recordPayment } from "@/modules/payment/payment.controller";
import { invoiceController as c } from "./invoice.controller";
import {
  invoiceListInput,
  createInvoiceInput,
  updateInvoiceInput,
  voidInvoiceInput,
} from "./invoice.schema";

const routes = Router();
routes.get(
  "/",
  requirePermission(P.INVOICE_READ),
  validate(invoiceListInput),
  c.list,
);
routes.get(
  "/:id",
  requirePermission(P.INVOICE_READ),
  validate(resourceParams),
  c.get,
);
routes.post(
  "/",
  writeLimmiter,
  requirePermission(P.INVOICE_CREATE),
  validate(createInvoiceInput),
  c.create,
);
routes.put(
  "/:id",
  writeLimmiter,
  requirePermission(P.INVOICE_UPDATE),
  validate(updateInvoiceInput),
  c.update,
);
routes.post(
  "/:id/void",
  writeLimmiter,
  requirePermission(P.INVOICE_DELETE),
  validate(voidInvoiceInput),
  c.void,
);
routes.post(
  "/:id/payments",
  writeLimmiter,
  requirePermission(P.INVOICE_UPDATE),
  validate(recordPaymentInput),
  recordPayment,
);
export default routes;
