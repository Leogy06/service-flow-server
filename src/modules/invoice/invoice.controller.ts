import type { RequestHandler } from "express";
import { sendResponse } from "@/utils/sendResponse.js";
import { invoiceService } from "./invoice.service.js";
import type { CreateInvoice, UpdateInvoice, InvoiceList } from "./invoice.schema.js";

export const invoiceController: Record<string, RequestHandler> = {
  list: async (req, res, next) => {
    try { sendResponse(res, 200, "Invoices fetched", await invoiceService.list(req.validated.query as InvoiceList)); } catch (error) { next(error); }
  },
  get: async (req, res, next) => {
    try { sendResponse(res, 200, "Invoice fetched", await invoiceService.get((req.validated.params as { id: string }).id)); } catch (error) { next(error); }
  },
  create: async (req, res, next) => {
    try { sendResponse(res, 201, "Invoice created", await invoiceService.create(req.validated.body as CreateInvoice)); } catch (error) { next(error); }
  },
  update: async (req, res, next) => {
    try { sendResponse(res, 200, "Invoice updated", await invoiceService.update((req.validated.params as { id: string }).id, req.validated.body as UpdateInvoice)); } catch (error) { next(error); }
  },
  void: async (req, res, next) => {
    try { sendResponse(res, 200, "Invoice voided", await invoiceService.void((req.validated.params as { id: string }).id, (req.validated.body as { reason: string }).reason)); } catch (error) { next(error); }
  },
};
