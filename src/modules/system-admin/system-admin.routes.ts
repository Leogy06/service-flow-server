import { Router } from "express";
import { authenticate } from "@/middleware/auth";
import { requireSystemAdmin } from "@/middleware/require-platform-admin";
import foundationRoutes from "./foundation.routes";
import billingRoutes from "./billing.routes";
import operationsRoutes from "./operations.routes";
import legacyAdminRoutes from "@/modules/user/routes/system-admin.routes";
import signupRoutes from "./signup.routes";

const routes = Router();
routes.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
routes.use(authenticate, requireSystemAdmin);
routes.use(signupRoutes);
routes.use(foundationRoutes);
routes.use(billingRoutes);
routes.use(operationsRoutes);
// Legacy creation retains a guard and can create organization-less ordinary accounts only.
routes.use(legacyAdminRoutes);
export default routes;
