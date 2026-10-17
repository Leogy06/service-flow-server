import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";

app.listen(env.PORT, () => {
  logger.info(`Server running on http://localhost:${env.PORT}`);
});
