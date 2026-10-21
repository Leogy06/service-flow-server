# Changed file inventory

Every changed application, test and documentation file for this task is listed below. Existing activity-log history is preserved. No secrets, database schema, migrations or dependency versions were changed.

## service-flow-server

| File | One-line summary |
| --- | --- |
| `.env.example` | Document placeholder Redis, namespace, proxy, timeout and policy overrides. |
| `ACTIVITY.md` | Prepend task footprints, actual checks and pending deployment validation. |
| `docker-compose.yml` | Provide loopback Redis with healthcheck, AOF and a named data volume. |
| `docs/DOCKER.md` | Update deployment documentation for the revised Redis/runtime configuration. |
| `docs/ENVIRONMENT.md` | Update deployment documentation for the revised Redis/runtime configuration. |
| `docs/LOGGING.md` | Update deployment documentation for the revised Redis/runtime configuration. |
| `docs/RATE_LIMITING.md` | Record ranked evidence, policy mounts, validation limits and DO migration checklist. |
| `docs/RATE_LIMIT_FILE_INVENTORY.md` | List every changed application, test and documentation file. |
| `docs/UPSTASH.md` | Update deployment documentation for the revised Redis/runtime configuration. |
| `docs/UPSTASH_RATE_LIMIT_SETUP.md` | Track deferred Upstash configuration and required staging validation. |
| `src/app.ts` | Expose rate headers, add opt-in proxy diagnostics and protect failed authentication. |
| `src/config/env-schema.ts` | Load policy defaults, local Redis fallback, bounded timeouts and proxy settings. |
| `src/config/rate-limit.ts` | Centralize validated environment names and all budget/window defaults. |
| `src/lib/logger.ts` | Use stdout on Vercel while preserving server log rotation. |
| `src/lib/rate-limit-store.ts` | Recover lazy Redis script initialization and observe post-response decrement failures. |
| `src/lib/redis.ts` | Reuse fail-fast ioredis and share a bounded cold-start readiness wait. |
| `src/middleware/clear-refresh-cookies.ts` | Clear both refresh-cookie paths once before logout limiting and in direct-controller calls. |
| `src/middleware/errorHandler.ts` | Include retryAfterSeconds in the established AppError JSON. |
| `src/middleware/rateLimiter.ts` | Define user/IP policy keys, independent auth/refresh budgets and safe 429 errors. |
| `src/modules/auth/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `src/modules/auth/auth.controller.ts` | Preserve direct-controller logout cookie clearing through the shared idempotent helper. |
| `src/modules/auth/auth.routes.ts` | Separate login/signup/refresh and apply per-user limits after private authentication. |
| `src/modules/feedback/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `src/modules/feedback/feedback.routes.ts` | Apply private per-user limits and retain the strict public write guard. |
| `src/modules/invoice/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `src/modules/invoice/invoice.controller.ts` | Expose the compatible aggregate-count response. |
| `src/modules/invoice/invoice.routes.ts` | Register the permission-checked counts route before resource-ID matching. |
| `src/modules/invoice/invoice.schema.ts` | Validate count reads using a strict empty query schema. |
| `src/modules/invoice/invoice.service.ts` | Cache one tenant-scoped status aggregate using existing invalidation. |
| `src/modules/job/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `src/modules/job/job.controller.ts` | Expose the compatible aggregate-count response. |
| `src/modules/job/job.routes.ts` | Register the permission-checked counts route before resource-ID matching. |
| `src/modules/job/job.schema.ts` | Validate count reads using a strict empty query schema. |
| `src/modules/job/job.service.ts` | Cache one tenant-scoped status aggregate using existing invalidation. |
| `src/modules/organization/branding.routes.ts` | Apply the per-user API limiter immediately after existing authentication. |
| `src/modules/organization/organization.route.ts` | Apply the per-user API limiter immediately after existing authentication. |
| `src/modules/organization/page.routes.ts` | Apply the per-user API limiter immediately after existing authentication. |
| `src/modules/permission/permission.route.ts` | Apply authenticated read and stricter write middleware. |
| `src/modules/role-permission/role.permission.routes.ts` | Apply the per-user API limiter immediately after existing authentication. |
| `src/modules/service-request/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `src/modules/service-request/service-request.controller.ts` | Expose the compatible aggregate-count response. |
| `src/modules/service-request/service-request.routes.ts` | Register the permission-checked counts route before resource-ID matching. |
| `src/modules/service-request/service-request.schema.ts` | Validate count reads using a strict empty query schema. |
| `src/modules/service-request/service-request.service.ts` | Cache one tenant-scoped status aggregate using existing invalidation. |
| `src/modules/system-admin/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `src/modules/system-admin/system-admin.routes.ts` | Apply the per-user API limiter immediately after existing authentication. |
| `src/modules/user-permission/user.permission.routes.ts` | Apply the per-user API limiter immediately after existing authentication. |
| `src/routes/index.ts` | Apply authenticated API budgets after authentication and retain public fallback coverage. |
| `src/utils/AppError.ts` | Type optional retryAfterSeconds metadata. |
| `tests/access-management/access.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/auth/profile.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/auth/set-password.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/cache/cache.test.ts` | Update isolated Redis readiness adapters and preserve existing regression coverage. |
| `tests/cache/redis-client.test.ts` | Check singleton reuse, fail-fast options and credential-safe logging. |
| `tests/cache/services.test.ts` | Update isolated Redis readiness adapters and preserve existing regression coverage. |
| `tests/config/environment.test.ts` | Validate centralized defaults, namespaces, proxy bounds and production TLS. |
| `tests/feedback/routes.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/logging/logger.test.ts` | Verify Vercel stdout configuration while retaining existing rotation tests. |
| `tests/organization/branding.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/organization/page.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/rate-limit/README.md` | Document isolated Redis regression commands and historical evidence. |
| `tests/rate-limit/baseline-runtime.mjs` | Preserve original shared-IP/refresh starvation reproduction (historical only). |
| `tests/rate-limit/policy.test.ts` | Check real app middleware order, budgets, response headers and auth failure coverage. |
| `tests/rate-limit/runtime-fixture.mjs` | Host isolated real limiter/Redis fixture processes without a database. |
| `tests/rate-limit/runtime.integration.mjs` | Verify cross-process counters, login separation and Redis outage recovery. |
| `tests/rate-limit/store.test.ts` | Check lazy script loads, namespaced commands, recovery and safe decrements. |
| `tests/system-admin/foundation.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/system-admin/refund-routes.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/system-admin/signup.test.ts` | Align middleware adapters, namespaces and bucket resets with current policy wiring. |
| `tests/workflow/sidebar-counts.test.ts` | Verify count permissions, tenant boundaries, empty groups and invalidation. |

## service-flow

| File | One-line summary |
| --- | --- |
| `ACTIVITY.md` | Prepend task footprints, actual checks and pending deployment validation. |
| `app/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `app/lib/api/client.ts` | Handle 429, single-flight refresh and session-safe delayed request recovery. |
| `app/lib/auth/AuthProvider.tsx` | Deduplicate cached session reads and pause hidden-tab checks. |
| `app/providers.tsx` | Share bounded read retries and visible-only polling defaults. |
| `components/features/login/components/use-login.ts` | Show the Retry-After wait message for login 429. |
| `docs/request-volume.md` | Record all page counts, frontend changes, fixture limitations and reproduction. |
| `features/audit-logs/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/audit-logs/hooks/use-audit-logs.ts` | Retain audit query cache and use capped read retries. |
| `features/billing/tests/invoice-form.browser.mjs` | Align existing browser fixtures with aggregate counts and session freshness. |
| `features/dashboard/README.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/dashboard/tests/dashboard.browser.mjs` | Align existing browser fixtures with aggregate counts and session freshness. |
| `features/dashboard/use-dashboard.ts` | Respect dashboard freshness and slow visible polling. |
| `features/feedback/tests/feedback.browser.mjs` | Align existing browser fixtures with aggregate counts and session freshness. |
| `features/jobs/tests/jobs-table.browser.mjs` | Align existing browser fixtures with aggregate counts and session freshness. |
| `features/jobs/tests/staff-conflicts.browser.mjs` | Align existing browser fixtures with aggregate counts and session freshness. |
| `features/organization/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/organization/hooks/use-organization-settings.ts` | Share fresh tenant branding with five-minute polling. |
| `features/profile/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/profile/hooks/use-profile.ts` | Remove unnecessary profile polling. |
| `features/service-requests/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/service-requests/api/service-request-api.ts` | Read aggregate request counts instead of four lists. |
| `features/service-requests/hooks/use-service-requests.ts` | Share request counts with two-minute polling. |
| `features/service-requests/tests/request-form.browser.mjs` | Align existing browser fixtures with aggregate counts and session freshness. |
| `features/service-requests/tests/request-table.browser.mjs` | Align existing browser fixtures with aggregate counts and session freshness. |
| `features/subscription/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/subscription/use-subscription.ts` | Cache browsing while allowing forced-fresh capacity checks. |
| `features/subscription/use-upgrade-plans.ts` | Reuse fresh plan data for one minute. |
| `features/system-admin/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/system-admin/components/operations-pages.tsx` | Start independent dashboard and alerts reads in parallel. |
| `features/system-admin/hooks.ts` | Deduplicate fresh platform counts and slow visible polling. |
| `features/users/FEATURE.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/users/components/add-user-dialog.tsx` | Fetch roles lazily and force a fresh capacity check on open. |
| `features/workflow/README.md` | Document changed cache, polling, count or limiter behavior in its feature. |
| `features/workflow/api.ts` | Read aggregate job/invoice counts instead of four lists. |
| `features/workflow/hooks.ts` | Share workflow counts with two-minute polling. |
| `features/workflow/tests/select-controls.browser.mjs` | Align existing browser fixtures with aggregate counts and session freshness. |
| `lib/utils/rate-limit.ts` | Parse Retry-After and supply typed wait messages and retry caps. |
| `package.json` | Add request-volume and retry/session verification commands without new packages. |
| `scripts/capture-product-previews.mjs` | Align sample preview counts with aggregate endpoints. |
| `tests/rate-limit.test.mjs` | Check Retry-After seconds/date/body parsing and capped backoff. |
| `tests/request-volume.browser.mjs` | Measure production navigation and verify 429 UI and hidden-tab behavior. |
| `tests/session-client.test.mjs` | Exercise real Axios refresh concurrency and session boundaries with local HTTP. |

## Runtime evidence outside the Git repositories

| File | One-line summary |
| --- | --- |
| `artifacts/rate-limits/request-volume-after.json` | Saved sample production browser or isolated real Redis verification evidence. |
| `artifacts/rate-limits/request-volume-before.json` | Saved sample production browser or isolated real Redis verification evidence. |
| `artifacts/rate-limit-20261021/baseline-runtime.json` | Saved sample production browser or isolated real Redis verification evidence. |
| `artifacts/rate-limit-20261021/compose-test.env` | Nonsecret local Compose port override used for the isolated Redis test. |
| `artifacts/rate-limit-20261021/runtime-outage.json` | Saved sample production browser or isolated real Redis verification evidence. |
| `artifacts/rate-limit-20261021/runtime-two-process.json` | Saved sample production browser or isolated real Redis verification evidence. |
