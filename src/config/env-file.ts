import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Works from source, compiled dist, Prisma CLI, and any working directory.
export function loadEnvironment() {
  const mode = process.env.NODE_ENV ?? "development";
  process.env.NODE_ENV = mode;
  // Tests may supply explicit isolated connection values over development defaults.
  const file = mode === "test" ? "development" : mode;
  if (!["development", "production"].includes(file)) return;
  config({
    path: fileURLToPath(new URL(`../../.env.${file}`, import.meta.url)),
    override: false,
    quiet: true,
  });
}
