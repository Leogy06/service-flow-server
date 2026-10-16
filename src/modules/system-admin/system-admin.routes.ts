import { Router } from "express";
import { authenticate } from "@/middleware/auth.js";
import { requireSystemAdmin } from "@/middleware/require-platform-admin.js";
import foundationRoutes from "./foundation.routes.js";
import billingRoutes from "./billing.routes.js";
import operationsRoutes from "./operations.routes.js";
import legacyAdminRoutes from "@/modules/user/routes/system-admin.routes.js";
import signupRoutes from "./signup.routes.js";

const routes = Router();
routes.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
routes.use(authenticate, requireSystemAdmin);
routes.use(signupRoutes);
routes.use(foundationRoutes);
routes.use(billingRoutes);
routes.use(operationsRoutes);
// Legacy creation retains a guard and can create organization-less ordinary accounts only.
routes.use(legacyAdminRoutes);
export default routes;
