# ServiceFlow platform administration

Implemented across `src/modules/system-admin`, authentication/authorization, user activation paths and the sibling Next.js `/system-admin` application. The implementation plan is at `../../SYSTEM_ADMIN_IMPLEMENTATION.md` in this workspace.

## Deployment and provisioning

1. Back up the target database and review `prisma/migrations/20261015090000_platform_administration/migration.sql`. Deploy backend and frontend together; older backends do not enforce the new security fields. Maintenance during rollout is recommended.
2. Run `npm run prisma:generate`, `npm run build`, then `npx prisma migrate deploy` against the intended target environment. MySQL DDL is not transactional; use the normal migration recovery procedure if deployment fails. The migration adds fields/tables/indexes and immutable platform-audit triggers. It does not delete data, promote identities, enroll existing tenants or seed prices. Provisioning and scheduler CLIs run compiled JavaScript and do not require development-only tsx in the deployed runtime.
3. Provision a separate platform identity with operator-supplied `SYSTEM_ADMIN_EMAIL`, `SYSTEM_ADMIN_PASSWORD` (14–72 bytes) and `SYSTEM_ADMIN_REASON`, then run `npm run bootstrap:system-admin`. Supply these through the shell or secret manager, never source control. Existing emails are refused. Normal seeds and tenant APIs cannot grant platform authority. Remove the bootstrap password from the process environment afterward.
4. Sign in at `/login`. An authorized organization-less administrator is routed to `/system-admin/dashboard`. Create the approved annual plans through `/system-admin/plans`. Proposed Starter PHP 2,999/3 users, Growth PHP 5,999/10 users, Business PHP 9,999/25 users are configurable proposals; no billing records or revenue are seeded.
5. Schedule `npm run alerts:process` at least daily using the deployment scheduler. Multiple workers can safely repeat the scan. Each bounded batch uses stable alert keys, organization locks and serializable transactions; the CLI follows cursors until complete (maximum 1,000 batches). It expires subscriptions and reconciles resolved conditions. The dashboard button runs the same processing with an audited operator reason.

Keep database sessions in UTC. UI date filters/report windows and trend day buckets use Asia/Manila. Configure HTTPS, secure cookies, trusted CORS origin, Redis and appropriately scoped database credentials through the existing environment configuration. Audit triggers reject platform-row updates/deletions; deployment database roles should additionally deny audit UPDATE/DELETE and schema modification to runtime credentials. There are no audit mutation endpoints.

The configured development/production database has not been migrated by this implementation. Migration and real integration verification ran against `service_flow_platform_test_20261015` only; tagged fixtures remain there intentionally.

## Identity and permission model

`User.platformRole=SYSTEM_ADMIN` is separate from tenant `Role`, `RolePermission` and `UserPermission`. A platform operator must be active, undeleted, unblocked and have no organization. A reserved role name or `system-admin:*` grant cannot confer authority. No tenant-managed endpoint writes platformRole or securityStatus. The legacy administrator-creation API remains guarded and cannot create tenant users or platform administrators.

Every `/api/system-admin` request passes the dedicated router's `authenticate` and `requireSystemAdmin` middleware. Sensitive mutations recheck authority inside their transaction. Cross-tenant reads here are explicitly privileged and select account/platform data only; no tenant jobs, invoices, payments or customer payloads are exposed. `/organization` list/create now require platform administration; check-slug remains a bounded public availability check, while by-id is limited to the authenticated organization or platform authority.

Account invitation lifecycle (`PENDING`/`ACTIVE`) and security status (`ACTIVE`/`BLOCKED`) are independent. Login, refresh and every protected request reload current database state. Suspended, inactive and archived organizations are denied; blocked accounts are denied even with valid old JWTs. Session versions invalidate existing JWTs after blocking, suspension, revocation, password changes and logout-all. Ordinary logout deletes its presented refresh session and invalidates all current access JWTs; other refresh sessions can rotate and continue. Refresh tokens are hashed at rest, httpOnly cookies are scoped to `/api/auth`, legacy cookies are cleared, and raw refresh values are never returned in JSON. Authentication endpoints are rate limited through Redis.

Tenant user deletion/restoration also increment session versions and revoke refresh sessions in the same transaction as the tenant audit. Restoration never revives an old login session, removes a platform block, or bypasses a seat ceiling. Legacy platform organization/account/permission creation and platform permission-override endpoints now require reason/confirmation and use validated primitive fields with transactional PLATFORM audits. Tenant permission-update contracts remain unchanged; old platform permission grants are preserved in storage but hidden from tenant permission responses and confer no authority.

## Lifecycle and financial rules

| Concern | Rule |
| --- | --- |
| Organization | ACTIVE, SUSPENDED, ARCHIVED; legacy INACTIVE retained. Changes require reason/confirmation, actor/time and transactional audit. Suspension/archive preserve records, revoke refresh sessions and invalidate JWTs. Archive retention is indefinite; explicit restoration changes only organization access status. |
| Security block | ACTIVE ↔ BLOCKED; does not change invitation lifecycle, seat consumption, organization status or subscription. Tenant admins cannot remove it. |
| Legacy access | Existing organizations default to billingEnabled=false. Assigning an initial subscription atomically enables billing; PENDING then denies business API access until verified payment. Enroll deliberately. |
| Entitlement | ACTIVE requires startsAt≤now<expiresAt. PAST_DUE permits only the configured 0–30-day grace after expiry. PENDING, EXPIRED and CANCELED deny access. Every tenant protected endpoint/login/refresh uses this check. |
| Subscription | Exactly one authoritative subscription per organization (unique key). PENDING → ACTIVE only through payment verification. Manual transitions: ACTIVE → PAST_DUE; PENDING/ACTIVE/PAST_DUE/EXPIRED → CANCELED. Scheduled expiry and verified renewal are audited with history. No arbitrary date extension or manual paid-status bypass. |
| Renewal | One calendar year, with February 29 clamped to February 28. Started, continuously paid ACTIVE/PAST_DUE coverage extends from max(now,expiry). CANCELED/EXPIRED renew fresh from now. Repeated verification of the same payment does not extend again. |
| Plan changes | Immediate seat ceiling; reject below active occupancy. Current paid price snapshot is preserved; current plan price/currency applies to the next confirmed renewal. Retired plans remain historically linked and renewable but cannot be newly assigned. Large seat reductions affecting >1,000 tenants require a replacement-plan rollout. |
| Seats | Count every undeleted ACTIVE team identity, including owners and blocked accounts. Customers and PENDING invitations do not count. Direct creation, invitation acceptance and restoration check seats under the same organization lock. No account deletion on downgrade. |
| Payments | PENDING → UNDER_REVIEW/PAID/REJECTED; UNDER_REVIEW → PAID/REJECTED; PAID → REFUNDED. No changes after rejection/refund. Exact current annual amount/currency, explicit trusted evidence, reason and confirmation are required for PAID. Unique reference and idempotency keys prevent replay. Changed request bodies cannot reuse keys. |
| Financial adjustments | Preserve paid records. Correct a finalized financial entry through an explicitly verified full refund and a new payment record, rather than editing the original amount. Partial refunds, proration and arbitrary cash credits are outside this annual-only policy. |
| Refunds | Full verified payment only, unique payment/refund key, confirmed evidence and reason. Gross receipts stay in reporting; refund events subtract on refund date. Rebuild only the remaining contiguous paid coverage chain. Historical ended-period refunds do not change present entitlement. Refunding the current period can leave future-only coverage; access is denied until that period begins and further renewals are rejected while the gap exists. Resolve such cases by separately verified refunds of remaining future periods before a fresh payment. Canceled paid periods cannot be regranted by refund recomputation. |

There is no payment gateway integration and no stored card credentials. CARD is only a manual payment-method label. Manual status/plan adjustments and financial corrections retain before/after history; operators must verify evidence outside this application before approving.

## API and UI contracts

Authenticated responses use the existing `{ success, statusCode, message, data }` envelope (see `sendResponse`); collections return `data.items` and bounded `data.pagination`. Mutation bodies require `confirm: true` and `reason`; billing changes additionally validate evidence and immutable idempotency keys. Request query allowlists reject unknown filters. Maximum page size is 100.

All paths below are relative to `/api/system-admin`:

| Method | Paths |
| --- | --- |
| GET | dashboard (from/to), monitoring, settings, alerts (page/pageSize/unread), reports/billing (CSV from/to) |
| GET | tenants, tenants/:id; users, users/:id; user-roles; audit-logs |
| POST | tenants/:id/status; users/:id/security; users/:id/revoke-sessions |
| GET/POST | plans; subscriptions; payments |
| GET | subscriptions/:id; payments/:id |
| PATCH | plans/:id; settings; alerts/:id/read |
| POST | subscriptions/:id/plan; subscriptions/:id/status; payments/:id/review; payments/:id/refund; alerts/process |

Tenants support name/slug search, organization/subscription status and name/createdAt/expiresAt sort. Users support name/email search, organization, role, invitation/security status and name/email/createdAt sort. Subscription/payment/plan lists have explicit filters and sorting. Detail history is bounded (20–100 latest records); full platform audit is separately paginated. User roles and organization/plan pickers are paginated searches.

Dedicated frontend routes: `/system-admin/dashboard`, `/tenants`, `/users`, `/subscriptions`, `/payments`, `/plans`, `/monitoring`, `/audit-logs`, `/settings`, with a `/system-admin` prefix on every route. The sibling layout uses platform navigation, memory-only access tokens, TanStack Query invalidation, reason/confirmation dialogs, Zod validation, toast feedback and loading/error/empty states. Frontend gating is solely UX; the API authorizes independently.

## Operations, reporting and limits

Dashboard records current organization/subscription/account counts; date filters apply to registrations, verified receipts, refund events, authentication failures and recent activity. Trends aggregate in SQL with indexed date bounds; date ranges are limited to 366 days. Revenue stays separated by currency and decimal arithmetic. No trials or unsupported metrics are invented. CSV reports cap at 10,000 financial events and neutralize spreadsheet formulas in text.

Monitoring shows live SELECT 1/Redis PING probes cached for 15 seconds with 2-second response deadlines, plus bounded per-process request counts/errors/latency observations for 60 minutes. The authorized monitoring route remains reachable when Redis rate-limit storage is down. p95 uses at most 256 observed request samples per minute; it is a bounded sample, not an external metrics service. Counters reset on restart and do not aggregate across replicas. Raw errors, credentials, URLs and connection strings are never returned; request IDs correlate sanitized error entries with server logs. Actual API 5xx responses automatically create deduplicated in-app critical alerts, with at most one persistence attempt per minute and one alert per instance/hour. DB storage and job metrics are unavailable because those instruments do not exist. Distributed error alerting and recovery across restarted instances need a shared metrics/log pipeline.

Platform settings persist only public payment instructions, support contacts, reminder days, grace policy, maintenance text and default plan. Secrets are excluded by strict schema. Plan/payment/audit reads are protected and administration responses use Cache-Control:no-store. User/IP/request details are restricted to authorized platform audit reads. Runtime logs redact authorization, cookies and password/token fields in every environment.

Platform authorization itself requires the database. A complete database outage therefore prevents authorized monitoring requests and is surfaced as an API error; use external infrastructure readiness checks for that case. Financial exports use a repeatable-read transaction so receipts and refund events form one consistent snapshot.

## Verification and later integrations

```powershell
npm test -- --runInBand --silent
npm run build
npm run lint
npx prisma validate
```

To provision and verify real database behavior using current connection credentials against a separate test database only:

```powershell
$env:PLATFORM_TEST_DATABASE_NAME = 'service_flow_platform_test_20261015'
node scripts/run-platform-mysql-tests.mjs --isolated-test-database
```

The runner checks a strict isolated name, creates only that database if absent, deploys migrations there and runs billing concurrency, operations/HTTP and compiled CLI canaries. Build the backend first. It never drops/resets any database or deletes immutable fixtures. Alternatively point all adapter variables and DATABASE_URL at an already migrated isolated test DB and run `npm run test:system-admin:mysql`. Frontend tests are documented in `service-flow/features/system-admin/README.md`; browser tests use a mock API and are distinct from the real MySQL tests.

Later integrations: MFA, gateway credentials and provider webhooks, email delivery, shared multi-instance telemetry, database storage metrics and background-job monitoring. The implementation provides an idempotent scheduler entry point; production scheduling and operator identity provisioning are deployment steps. No production deploy or existing database migration has been performed.

## Verification recorded on 15 October 2026

- Backend: 22 Jest suites / 481 tests passed; full source/test TypeScript check, production build, ESLint, Prisma schema validation and whitespace checks passed.
- Frontend: production build, TypeScript, full ESLint and whitespace checks passed; 22 Node tests and three sequential browser suites passed (platform foundation, platform operations, existing tenant users).
- Real MySQL: three isolated canaries passed for migration/constraints, concurrent payment/refund and seat limits, immutable audit, real dashboard/refund reports, CSV injection, expiration/alert deduplication, platform HTTP authorization, actual error alerts and compiled bootstrap/scheduler commands.
- Browser tests use mock APIs; real database tests use only `service_flow_platform_test_20261015`. Both are needed and verify different boundaries. Screenshots were inspected at `../../artifacts/system-admin/`.
