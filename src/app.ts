import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { router } from "./routes/index";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { withRequestContext } from "./middleware/requestContext.middleware";
import { requestLogger } from "./middleware/request-logger";
import { unauthenticatedErrorLimiter } from "./middleware/rateLimiter";
import { logger } from "./lib/logger";
import {
  observeRequests,
  onPlatformServerError,
} from "./modules/system-admin/telemetry";
import { recordPlatformServerError } from "./modules/system-admin/operations.service";

export const app = express();
app.set("trust proxy", env.TRUST_PROXY_HOPS);
onPlatformServerError(recordPlatformServerError);

// Register first so CORS preflights and other early responses are logged too.
app.use(requestLogger);
let loggedProxyDiagnostic = false;
app.use((req, _res, next) => {
  if (env.TRUST_PROXY_DIAGNOSTICS && !loggedProxyDiagnostic) {
    loggedProxyDiagnostic = true;
    // Opt-in, once per warm runtime; never include cookies or authorization headers.
    logger.info({ ip: req.ip, forwardedFor: req.get("X-Forwarded-For")?.slice(0, 512), trustProxyHops: env.TRUST_PROXY_HOPS }, "Proxy IP diagnostic");
  }
  next();
});
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true, exposedHeaders: [
  "Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "RateLimit-Policy", "RateLimit", "X-Request-Id",
] }));
app.use(compression()); // gzip reduces the size of the response
app.use(observeRequests);
app.use(express.json());
app.use(cookieParser());

app.use("/api", withRequestContext);
app.use("/api", router);

app.use(notFound);
app.use(unauthenticatedErrorLimiter);
app.use(errorHandler);
