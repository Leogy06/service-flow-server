import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { router } from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFound } from "./middleware/notFound.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { withRequestContext } from "./middleware/requestContext.middleware.js";
import { requestLogger } from "./middleware/request-logger.js";
import { observeRequests, onPlatformServerError } from "./modules/system-admin/telemetry.js";
import { recordPlatformServerError } from "./modules/system-admin/operations.service.js";

export const app = express();
onPlatformServerError(recordPlatformServerError);

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(compression()); // gzip reduces the size of the response
app.use(requestLogger);
app.use(observeRequests);
app.use(express.json());
app.use(cookieParser());

app.use("/api", apiLimiter);
app.use("/api", withRequestContext);
app.use("/api", router);

app.use(notFound);
app.use(errorHandler);
