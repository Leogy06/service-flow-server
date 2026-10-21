import { defineConfig } from "prisma/config";
import { loadEnvironment } from "./src/config/env-file";
import { databaseEnvironmentSchema, prismaDatasourceUrl } from "./src/config/database";

loadEnvironment();
// Generation/migrations need database config, not unrelated email/JWT credentials.
const result = databaseEnvironmentSchema.safeParse(process.env);
if (!result.success) {
  throw new Error("Invalid database environment:\n" + result.error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n"));
}
const env = result.data;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
    path: "prisma/migrations",
  },
  datasource: {
    url: prismaDatasourceUrl(env.DATABASE_URL),
  },
});
