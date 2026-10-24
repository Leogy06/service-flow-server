# Rate limit diagnosis, changes and validation

Email 2FA adds shared login/resend IP and account delivery budgets plus a separate
verification IP policy, all fail closed through the existing Redis store. Device
settings use authenticated `apiLimiter`, `writeLimiter` and `strictLimiter`.
See [2FA configuration and API details](EMAIL_TWO_FACTOR.md).

## Diagnosis first

The unmodified backend was exercised against an isolated Docker Redis before
application changes. The frontend baseline used Next.js 16.3.8 `next build` and
`next start` with the existing local sample API. The samples are not measurements
of deployed users, database latency or Upstash. Raw evidence is in the workspace's
`artifacts/rate-limit-20261021` and `artifacts/rate-limits` directories.

Ranked causes, with **before-change** source locations:

| Impact | Finding | Evidence |
| --- | --- | --- |
| 1 | All users shared 300 requests per 15 minutes. | `src/app.ts:32` mounted `apiLimiter` before `src/routes/index.ts:25-37` authentication; `src/middleware/rateLimiter.ts:60-71` therefore always used its IP fallback. Real Redis returned remaining 299 for fixture user A, then 298 for B on the same connection/IP, policy `300;w=900`. |
| 2 | Refresh could prevent login. | `src/modules/auth/auth.routes.ts:20-33` shared `authLimiter` between register/login/refresh. Ten successful fixture refresh responses exhausted its 10/15-minute IP budget; the next login was 429 with Retry-After 900. Successful responses were not skipped. |
| 3 | Fixed sidebar and session traffic consumed the shared bucket while idle. | Tenant sidebar counts expanded into eight list calls (`features/service-requests/api/service-request-api.ts:8-13`, `features/workflow/api.ts:11-14,40-43`). Tenant intervals implied about 10 requests/minute including session/branding; platform about 7. See the frontend report below. |
| 4 | Unrelated staff shared tiny mutation budgets. | `src/middleware/rateLimiter.ts:74-90,132-140` used the default IP key for strict 5/hour, write 30/hour and delete 1/15 minutes. Deletes applied specifically to users and roles; ordinary customers/requests/jobs/invoices used the write budget. |
| 5 | Environments could interfere, and cold Redis failure could prevent recovery. | Old prefixes were `rl:${name}:`; Redis was module-only with retry count 3 and offline queuing enabled. Installed rate-limit-redis 6.0.1 cached rejected script SHA promises after an unsuccessful init. |

Other suspected causes:

- **OPTIONS:** not a source of limiter consumption in this app. CORS precedes
  the router and terminates ordinary preflights; policies now also skip OPTIONS.
- **Proxy IP:** `TRUST_PROXY_HOPS` defaulted to 0 and could only represent 0/1.
  The local diagnostic observed `req.ip=127.0.0.1` while a supplied XFF was
  `198.51.100.42`; trusting no proxy correctly ignored that header. Deployment
  Vercel hops could not be inferred from local traffic and must be checked there.
  Validated local configuration resolves to development mode/namespace, zero
  trusted hops, loopback Redis and the 300/60,000ms API budget.
- **Next server requests:** protected API calls are browser Axios requests with
  the in-memory bearer; there is no authenticated Next-to-Express hop to forward.
  Public website rendering calls Express server-side without a user identity.
  Its IP bucket may group visitors behind Vercel; request-local deduplication
  already exists. Do not trust a browser-supplied identity/IP header to solve this.
- **Prefetch:** no extra Express calls were attributable to sidebar prefetching
  in the measured production build, so links keep their existing behavior.

## Production frontend counts

| Scope | Before | After |
| --- | ---: | ---: |
| Tenant cold dashboard | 14 | 9 |
| Tenant cold profile document | 13 | 8 |
| Tenant user-management navigation | 3 | 2 |
| Tenant jobs / roles navigation | 2 each | 2 each |
| Other ordinary tenant page navigation | 0-1 each | 0-1 each |
| 15 tenant transitions, including the cold documents | 44 | 33 |
| Platform cold dashboard | 6 | 6 |
| Other 10 platform pages | 1 each | 1 each |
| Platform fresh dashboard revisit | 0 | 0 |
| 12 platform transitions total | 16 | 16 |

Tenant preflights decreased 40 to 29. The tenant fixture intentionally exercises
401 -> refresh -> retry at bootstrap; platform begins authenticated, so compare
each layout against its own baseline. Polling configuration implies tenant
background traffic about 10 -> 2.7/minute and platform 7 -> 2.5/minute while
visible; these are calculations, not a 15-minute soak measurement. Hidden interval
callbacks plus ten focus events produced zero requests in both layouts; ten
fresh visible focus events also produced zero. Production fixture navigation
reported no unhandled browser errors. Actual Redis enforcement was tested
separately, not through the full browser/database stack.

The [frontend report](../../service-flow/docs/request-volume.md) contains all
per-page counts, request URLs, fixture assumptions, retry tests and reproduction.

## Policy and mounts

All budgets live in `src/config/rate-limit.ts`, merged into the validated schema
used by `src/config/env.ts`; overrides use `<NAME>_RATE_LIMIT_MAX` and
`<NAME>_RATE_LIMIT_WINDOW_MS`. No defaults are scattered through middleware.

| Export / environment name | Default | Key | Mounts |
| --- | --- | --- | --- |
| `apiLimiter` / API | 300/min | `u:<persisted user id>`; IP fallback | After `authenticate`: users, customers, service-requests, jobs, invoices, role, audit-logs, dashboard routers; private auth/profile, organization, branding/page, permission, role-permission, user-permission, private feedback and system-admin routes. |
| `publicApiLimiter` / PUBLIC_API | 60/min | IP/IPv6 subnet | Organization check-slug, auth logout, unmatched paths, rejected private authentication. |
| `authLimiter` / AUTH | 10/15min | IP/IPv6 subnet | POST auth/login only. Successful 2xx responses are decremented. No 2FA verification endpoint currently exists; a future verification endpoint needs its own strict failed-attempt policy. |
| `refreshLimiter` / REFRESH | 60/min | Verified signed bearer subject when available; otherwise IP | POST auth/refresh. Signature verification may ignore expiry for the key only; refresh-cookie validation and rotation remain in the auth service. Arbitrary cookies or unsigned subjects never select buckets. |
| `signupLimiter` / SIGNUP | 5/10min | IP | POST auth/register; no login bucket stacking. |
| `strictLimiter` / STRICT | 5/hour | User when authenticated; IP otherwise | POST auth/set-password, auth/logout-all, auth/change-password, users/:id/reset-password. |
| `writeLimiter`, alias `writeLimmiter` / WRITE | 30/min | User, fallback IP | Auth profile PATCH; user create/update/invite/role/restore; role create/update/restore; permission POST; role/user permission mutations; customer mutations; request/type mutations; job mutations/cancel; invoice/payment/void mutations; organization create/upgrade-request/settings/page/assets mutations; private feedback mutations; system-admin signup review, tenant/user/security, plan/subscription/payment/refund, alerts/settings/maintenance and legacy admin creation mutations. |
| `deleteLimiter` / DELETE | 5/15min | User, fallback IP | DELETE users/:id, role/:id. Still limited as sensitive administrative actions; other domain deletes retain WRITE. |
| `refundLimiter` / REFUND | 10/hour, unchanged | User, fallback IP | POST system-admin/payments/:id/refund-requests, refund-review, refund. Dedicated financial protection retained, including existing write guard. |
| `feedbackLimiter` / FEEDBACK | 20/10min, unchanged | IP | POST public/feedback/context, submit, withdraw-consent. |
| `publicWriteLimiter` / PUBLIC_WRITE | 30/hour, unchanged public budget | IP | POST public/feedback/submit, withdraw-consent. Preserves the original public-write guard independently of normal tenant writes. |
| `brandingUploadLimiter` / BRANDING_UPLOAD | 10/min, unchanged | User, fallback IP | POST organization/settings/logo and favicon; existing write guard retained. |
| `brandingAssetLimiter` / BRANDING_ASSET | 60/min, unchanged | IP | GET organization/branding-assets/:filename. |
| `publicPageLimiter` / PUBLIC_PAGE | 60/min, unchanged | IP | GET organization/public-page/:slug. |

Health GET `/api/health` is an unmetered lightweight liveness response. Authorized
GET `/api/system-admin/monitoring` retains the existing API-budget exemption, so
operators can inspect dependency failures. Both its authentication and persisted
platform authorization still run. Policies also skip OPTIONS. Specialist public
routes use their own budgets rather than adding a general API Redis increment.
Sensitive refund/upload guards remain intentionally layered.

The new authenticated GET `/api/service-requests/counts`, `/api/jobs/counts` and
`/api/invoices/counts` require their existing READ permissions and the per-user
API limiter. Each replaces status list reads with one tenant-scoped groupBy and
reuses the existing scoped cache and mutation invalidation. Empty query schemas
reject tenant/filter selectors. No database schema or permission changes.

## Redis, failures and response contract

- Keep ioredis TCP: local default `redis://localhost:6379`; production requires
  verified TLS `rediss://...`. The existing production validator rejects the local
  default. No REST client or Upstash-specific limiter was introduced.
- Redis is reused through `globalThis`; listeners are installed once. Defaults
  are 2-second connect/command timeouts, one retry per request and offline queue
  disabled. Each middleware creates one store. Scripts load lazily on first use;
  a shared bounded readiness wait allows a healthy TCP cold start to complete
  before SCRIPT LOAD, without introducing offline command queues.
  failed loads remain observable and retryable after recovery. Concurrent recovery
  requests share initialization. Successful-login decrement failures are caught
  and logged; retaining a hit is conservative and cannot crash the process.
- General authenticated API traffic uses `passOnStoreError: true` and logs a loud
  policy-specific error. This does not bypass authentication, permissions or
  writes. Every other policy fails closed with operational 503
  `RATE_LIMIT_STORE_UNAVAILABLE`; no per-instance memory fallback is used because
  it would fragment security enforcement across serverless instances.
- Keys are `rl:<APP_ENV>:<policy>:<key>`. APP_ENV resolves centrally from an
  explicit override, then VERCEL_ENV, then NODE_ENV. Use a stable distinct APP_ENV
  per preview branch when previews share Redis. Never select the namespace from
  request input. Moving to the new namespace resets old counters once at rollout.
- Exhaustion retains `{ error, code: "RATE_LIMITED" }` and adds numeric
  `retryAfterSeconds`; Retry-After and draft-6 RateLimit-* response headers are
  exposed through CORS. The frontend honors them with a toast, capped exponential
  read retry and no automatic mutation retries. Login shows the wait inline.

## Verification and limitations

Completed checks are recorded in ACTIVITY.md and the raw JSON artifacts:

- Real Docker Redis with two independent Express fixture processes: shared
  counters, separate users on one IP, independent refresh, successful-login
  restoration, failed-login blocking and Retry-After/body verification.
- Real Redis down at cold start, same-process recovery after restart and failure
  precisely during post-response login decrement. Browsing returned 200; login
  returned 503; protection resumed after recovery without unhandled rejection.
- Isolated Compose Redis healthcheck and named-volume AOF persistence across a
  restart. No existing local Redis keys were deleted or databases modified.
- Application middleware tests import the actual app, auth/root route mounting,
  limiter, CORS and error handler; only authentication/controllers/resources and
  storage adapters are fixtures. Service tests exercise count isolation, permission
  revocation and cache invalidation. Existing auth/organization/feedback/refund
  and access regression suites are included in final validation.

The frontend build, fixture browser and Redis policy tests are complementary;
they do not establish deployed database performance or a live credential login.
No staging Upstash credentials are configured. The user deferred that check;
follow [the setup reminder](UPSTASH_RATE_LIMIT_SETUP.md) before release. Full
production login/refresh navigation and proxy diagnostics remain deployment checks.

The final broad backend run passed 1,035 tests with two unrelated failures:
the existing `subscriptionrefund`
migration-table casing assertion, and an existing logger rotation test whose
declared `pino-roll` dependency is absent from this installation. The initial
asynchronous MemoryStore mock linking failure was corrected; the repeat full run
loaded every suite (44 passed, two failed). Build, source/test TypeScript and
ESLint passed. Frontend production build, ten retry/session transport tests and
four existing browser suites passed; final fixture 429 recovery made two attempts
2,031ms apart. Real Redis completed seven normal/two-instance checks and three
outage checks. Focused application readiness/store/logout checks passed 24 tests.

Final session review added boundaries around queued requests, delayed responses,
401 replay and refresh completion: a request started under a prior login is
cancelled rather than replayed under a later login. Logout clears current and
legacy refresh-cookie paths even when its IP guard blocks server-side revocation.
The old refresh HTTP request is aborted at the session boundary before stale
response-cookie headers can arrive; a real HTTP cancellation regression passed.
A browser cookie-jar race integration test was not run.

Local Redis regression runner (from backend; start isolated Redis on 16379):

```powershell
node --import tsx tests/rate-limit/runtime.integration.mjs
npm.cmd test -- --runInBand tests/rate-limit tests/workflow/sidebar-counts.test.ts
```

`baseline-runtime.mjs` is historical before-fix evidence, intentionally not a
regression command for the new policies. The outage runner's `--outage` mode
requires starting with only its dedicated Redis stopped, then restarting it at
the printed prompt. Never stop production/shared Redis for this check.

## Vercel to DigitalOcean checklist

1. Carry over secrets privately and set APP_ENV, all desired rate-limit overrides,
   API PORT, public frontend API URL, DATABASE_URL and REDIS_URL. Keep Upstash or
   use a compatible DO Redis/Valkey TCP URL; preserve TLS/certificate validation.
   The existing database adapter already pools connections and uses globalThis;
   size the aggregate per-instance pools against database capacity.
   Install locked dependencies and build both applications; this workspace is
   missing the declared `pino-roll` package needed by the VPS file logger.
2. Set `TRUST_PROXY_HOPS=0` for direct local access. A single private Nginx/Caddy
   hop normally uses 1; Cloudflare plus Nginx/load balancer may use 2. Block direct
   API access, sanitize forwarded headers and confirm every reachable path has
   the same hop count before setting it. Numeric hops are not a blanket trust of
   arbitrary XFF. On Vercel, verify its actual forwarded chain first.
3. Enable `TRUST_PROXY_DIAGNOSTICS=true` temporarily. One request per warm runtime
   logs req.ip, bounded X-Forwarded-For and configured hops; confirm a browser's
   real client IP, then disable diagnostics. Never log cookies or bearer tokens.
4. Update exact CORS_ORIGIN and frontend NEXT_PUBLIC_API_URL, then rebuild Next
   because its public API URL is compiled into the bundle. Confirm credentials,
   OPTIONS and exposed Retry-After/RateLimit-* headers from the real browser origin.
5. Check refresh-cookie host/domain and SameSite. Current cookies are host-only,
   Secure in production, SameSite Strict, path `/api/auth`; keep frontend/API
   same-site (e.g. app/api under the same registrable custom domain). Unrelated
   preview domains need an explicit cookie/CSRF design review rather than assuming
   Strict cookies will cross sites. Do not widen cookie domains casually.
6. Route health checks to GET `/api/health`; use authenticated monitoring for
   database/Redis dependency status. Verify both during the cutover.
7. Immediately test login, parallel token-expiry requests, refresh rotation,
   failed-login blocking, logout, two users and 10+ pages in both layouts. Check
   rate headers and Redis errors before switching all traffic; retain rollback.

Serverless audit: no backend WebSocket server or periodic setInterval job was
found. Alert processing is an explicit CLI and needs an external scheduler;
process-local telemetry is per instance and best-effort post-response alert work
is not durable. Production logs now use stdout on Vercel; local rotating logs
remain for long-running servers. Branding uses local `storage/branding`, which
still requires durable object storage or a mounted volume before relying on
uploads in serverless. `src/index.ts` is the long-running listen entry and
`src/app.ts` exports the Express app; deployed Vercel entry configuration was not
available here. None of these deployment hazards was silently treated as verified.

Slow endpoints: production p50/p95 and query plans were not collected. Existing
job filter options still load several independent aggregates/choice lists; platform
financial/reporting reads and live authorization merit measurement. No speculative
database indexes or caching of authorization were added.

Proxy guidance was checked against the official [Express proxy documentation](https://expressjs.com/en/guide/behind-proxies/)
and [Vercel request headers documentation](https://vercel.com/docs/headers/request-headers).
Store behavior was inspected directly in the installed express-rate-limit 8.6.2
and rate-limit-redis 6.0.1 source. The [file inventory](RATE_LIMIT_FILE_INVENTORY.md)
lists every changed application, test and documentation file.
