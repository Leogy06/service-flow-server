import type { Request, RequestHandler } from "express";
import { sendResponse } from "@/utils/sendResponse.js";
import { serviceRequestService as service } from "./service-request.service.js";
import type { CreateRequest, UpdateRequest, RequestList, CreateType, UpdateType, TypeList } from "./service-request.schema.js";
import type { ServiceRequestStatus } from "@/generated/prisma/client.js";

function handler(work: (req: Request) => Promise<unknown>, message: string, status = 200): RequestHandler {
  return async (req, res, next) => {
    try { sendResponse(res, status, message, await work(req)); }
    catch (error) { next(error); }
  };
}
const id = (req: Request) => (req.validated.params as { id: string }).id;
export const serviceRequestController = {
  list: handler((req) => service.list(req.validated.query as RequestList), "Service requests fetched"),
  get: handler((req) => service.get(id(req)), "Service request fetched"),
  customers: handler((req) => service.customers(req.validated.query as { page: number; pageSize: number; search: string }), "Customers fetched"),
  create: handler((req) => service.create(req.validated.body as CreateRequest), "Service request created", 201),
  update: handler((req) => service.update(id(req), req.validated.body as UpdateRequest), "Service request updated"),
  status: handler((req) => service.status(id(req), (req.validated.body as { status: ServiceRequestStatus }).status), "Request status updated"),
  types: handler((req) => service.types(req.validated.query as TypeList), "Service types fetched"),
  createType: handler((req) => service.createType(req.validated.body as CreateType), "Service type created", 201),
  updateType: handler((req) => service.updateType(id(req), req.validated.body as UpdateType), "Service type updated"),
  archiveType: handler((req) => service.updateType(id(req), { isActive: false }), "Service type archived"),
};
