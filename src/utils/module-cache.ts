import { createHash } from "node:crypto";
import { requestContext } from "@/lib/requestContext";
import { DEFAULT_TTL_SECONDS, getOrSetCache, invalidateCache } from "@/utils/cache";

// Each entry lists projections that embed or aggregate the changed resource.
const dependencies = {
  customers: ["customers", "serviceRequests", "jobs", "invoices", "dashboard"],
  serviceRequests: ["serviceRequests", "jobs", "dashboard"],
  serviceTypes: ["serviceTypes", "serviceRequests", "jobs", "dashboard"],
  jobs: ["jobs", "serviceRequests", "dashboard"],
  invoices: ["invoices", "jobs", "dashboard"],
  users: ["users", "roles", "jobs", "upgradePlans", "dashboard", "platformDashboard"],
  roles: ["roles", "users", "jobs", "upgradePlans", "dashboard"],
  branding: ["branding"],
  organization: ["branding", "upgradePlans", "platformDashboard"],
  upgradePlans: ["upgradePlans", "platformDashboard"],
  plans: ["plans", "upgradePlans", "platformDashboard"],
  subscriptions: ["upgradePlans", "platformDashboard"],
  dashboard: ["dashboard"],
  platformDashboard: ["platformDashboard"],
} as const;

export type CacheModule = keyof typeof dependencies;
const platformModules = new Set<CacheModule>([
  "plans", "platformDashboard",
]);
const scopeKey = (scope: string) => encodeURIComponent(scope);
const namespace = (module: CacheModule, scope?: string) =>
  `modules:v1:${module}${scope === undefined ? "" : `:${scopeKey(scope)}`}`;

export function cachedRead<T>(
  module: CacheModule,
  operation: string,
  parameters: unknown,
  fetcher: () => Promise<T>,
  options: { scope?: string; ttl?: number } = {},
): Promise<T> {
  const ctx = requestContext.get();
  // Explicit scopes must come from trusted service context, never request input.
  const scope = options.scope ?? (platformModules.has(module) ? "platform" : ctx?.organizationId);
  if (!scope) return fetcher();
  const digest = createHash("sha256").update(JSON.stringify({
    operation, parameters,
    userId: ctx?.userId, role: ctx?.role,
    permissions: [...(ctx?.permissions ?? [])].sort(),
  })).digest("hex");
  const local = namespace(module, scope);
  return getOrSetCache(`cache:${local}:${digest}`, options.ttl ?? DEFAULT_TTL_SECONDS, fetcher, [namespace(module), local]);
}

export async function invalidateModuleCache(
  source: CacheModule | readonly CacheModule[],
  organizationId: string | undefined = requestContext.getValue("organizationId"),
): Promise<void> {
  const sources = typeof source === "string" ? [source] : source;
  const affected = new Set<CacheModule>(sources.flatMap((module) => [...dependencies[module]]));
  await Promise.all([...affected].map((module) => {
    const scope = platformModules.has(module) ? "platform" : organizationId;
    const version = namespace(module, scope);
    return invalidateCache(`cache:${version}:*`, version);
  }));
}

export async function invalidating<T>(
  source: CacheModule | readonly CacheModule[],
  work: () => Promise<T>,
): Promise<T> {
  const result = await work();
  // Only reached after a successful commit. Failed/rolled-back writes retain caches.
  await invalidateModuleCache(source);
  return result;
}
