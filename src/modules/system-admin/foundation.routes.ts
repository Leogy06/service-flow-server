import { Router, type Request, type Response, type NextFunction } from "express";
import { validate } from "@/middleware/validate.js";
import { writeLimmiter } from "@/middleware/rateLimiter.js";
import { sendResponse } from "@/utils/sendResponse.js";
import { foundationService as service } from "./foundation.service.js";
import { userRoleListSchema, type UserRoleListQuery } from "./foundation.schema.js";
import { tenantListSchema, userListSchema, auditListSchema, detailSchema, tenantStatusSchema, userSecuritySchema, revokeSessionsSchema, type TenantListQuery, type UserListQuery, type AuditListQuery, type TenantStatusInput, type UserSecurityInput, type RevokeSessionsInput } from "./foundation.schema.js";
const router = Router();
const handle = (work: (req: Request) => Promise<unknown>, message: string) => async (req: Request, res: Response, next: NextFunction) => {
  try { sendResponse(res, 200, message, await work(req)); } catch (error) { next(error); }
};
const id = (req: Request) => (req.validated.params as { id: string }).id;
router.get("/tenants", validate(tenantListSchema), handle((req) => service.tenants(req.validated.query as TenantListQuery), "Tenants fetched"));
router.get("/tenants/:id", validate(detailSchema), handle((req) => service.tenant(id(req)), "Tenant fetched"));
router.post("/tenants/:id/status", writeLimmiter, validate(tenantStatusSchema), handle((req) => service.tenantStatus(id(req), req.validated.body as TenantStatusInput), "Tenant status updated"));
router.get("/users", validate(userListSchema), handle((req) => service.users(req.validated.query as UserListQuery), "Users fetched"));
router.get("/user-roles", validate(userRoleListSchema), handle((req) => service.userRoles(req.validated.query as UserRoleListQuery), "Tenant roles fetched"));
router.get("/users/:id", validate(detailSchema), handle((req) => service.user(id(req)), "User fetched"));
router.post("/users/:id/security", writeLimmiter, validate(userSecuritySchema), handle((req) => service.userSecurity(id(req), req.validated.body as UserSecurityInput), "User security updated"));
router.post("/users/:id/revoke-sessions", writeLimmiter, validate(revokeSessionsSchema), handle((req) => service.revokeSessions(id(req), req.validated.body as RevokeSessionsInput), "Sessions revoked"));
router.get("/audit-logs", validate(auditListSchema), handle((req) => service.auditLogs(req.validated.query as AuditListQuery), "Platform audit logs fetched"));
export default router;
