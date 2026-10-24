import { createHash } from "node:crypto";
import { registerSchema } from "../../src/modules/auth/auth.schema.js";

export const DEVELOPMENT_SEED = "development-workspace-v1";
export const developmentId = (key: string) =>
  `c${createHash("sha256").update(`${DEVELOPMENT_SEED}:${key}`).digest("hex").slice(0, 24)}`;

export const developmentOrganizations = [
  {
    name: "Acme Plumbing Co.",
    slug: "acme-plumbing",
    billing: "pending",
    color: "#2563eb",
  },
  {
    name: "Bright Star Electrical",
    slug: "bright-star-electrical",
    billing: "paid",
    color: "#0d887d",
  },
  {
    name: "Summit HVAC Services",
    slug: "summit-hvac",
    billing: "trial",
    color: "#7c3aed",
  },
] as const;
export const developmentOperatorEmail = "leogy_santiIIan850@outlook.com";
export const developmentUserEmail = (slug: string, role: string) =>
  `${role.toLowerCase()}@${slug}.example.test`;

/** Defense in depth for direct execution outside the environment-selecting wrapper. */
export function assertDevelopmentSeedTarget(environment: {
  NODE_ENV: string;
  DATABASE_URL: string;
}) {
  if (environment.NODE_ENV !== "development")
    throw new Error("Development samples require NODE_ENV=development.");
  const target = new URL(environment.DATABASE_URL);
  if (
    target.protocol !== "mysql:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  ) {
    throw new Error("Development samples require a local MySQL database.");
  }
}

export function developmentPassword(value: unknown) {
  const parsed = registerSchema.shape.body.shape.password.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Set DEV_SEED_PASSWORD in .env.development (8-72 characters with uppercase, lowercase and a number). It is never printed or reset on reruns.",
    );
  return parsed.data;
}
