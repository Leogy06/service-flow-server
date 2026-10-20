import { z } from "zod";
import { envSchema } from "./env-schema";
import { loadEnvironment } from "./env-file";

loadEnvironment();
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:\n" + parsed.error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`).join("\n"));
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
