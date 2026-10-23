# Visitor access logs

Platform-wide API traffic, separate from tenant business/audit records. The existing
singleton Prisma client writes `access_logs`; only persisted platform administrators
can read it through the existing authentication and authority middleware.

- `../../middleware/access-logger.ts`: registered before routes/CORS, records only IP,
  method, path without query strings, status, elapsed ms, geo headers and user agent.
  Inserts run on response finish through Vercel `waitUntil`; failures are sanitized
  console errors and cannot fail the response. Health, favicon, cron and both admin
  prefixes are excluded. Header IPs must be valid IPv4/IPv6.
- `access-logs.routes.ts`: `/api/admin/access-logs` and `/top-ips`, with equivalent
  `/api/system-admin/access-logs` aliases for the existing frontend API helper.
  Existing `authenticate`, `apiLimiter`, `requireSystemAdmin`, no-store responses.
- `access-logs.schema.ts`: one-based page, positive limit capped at 200, exact IP.
- `access-logs.service.ts`: newest first, 24-hour top 20 (country from latest hit),
  and indexed 30-day deletion. Logs have no tenant owner; tenant admins are denied.
- `/api/cron/access-logs`: existing `publicApiLimiter`, CRON_SECRET bearer check,
  once daily at 00:00 UTC (08:00 Asia/Manila). No secret configured means deny.

The server trusts forwarding proxies as requested. `x-client-ip` is honored only
with matching `x-internal-api-secret`. Keep INTERNAL_API_SECRET server-only on both
deployments. No cookies, bodies, authorization, or query values are stored. Direct
Next.js requests that never reach Express are outside this API logging scope.

Use `prisma db push`, not migrations, for this addition. Review the schema diff first;
never use `--accept-data-loss`. See `../../../docs/ACCESS_LOGGING.md` for setup and
verification. Daily pruning means rows can remain until the next daily run after
their 30-day cutoff; Vercel cron execution must be monitored in production.
