import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { router } from "./routes/index";
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { apiLimiter } from "./middleware/rateLimiter";
import { withRequestContext } from "./middleware/requestContext.middleware";
import { requestLogger } from "./middleware/request-logger";
import {
  observeRequests,
  onPlatformServerError,
} from "./modules/system-admin/telemetry";
import { recordPlatformServerError } from "./modules/system-admin/operations.service";

export const app = express();
onPlatformServerError(recordPlatformServerError);

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(compression()); // gzip reduces the size of the response
app.use(requestLogger);
app.use(observeRequests);
app.use(expresson());
app.use(cookieParser());

app.use("/api", apiLimiter);
app.use("/api", withRequestContext);
app.use("/api", router);

app.use(notFound);
app.use(errorHandler);
