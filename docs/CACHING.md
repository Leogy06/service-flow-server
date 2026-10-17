# Service read caching

`src/utils/cache.ts` provides best-effort Redis read-through caching. Redis
failures fall back to the database; database failures still propagate. Tagged
serialization preserves Date, Prisma Decimal, bigint and nested JSON values.
Invalidation uses SCAN rather than KEYS.

`src/utils/module-cache.ts` defines the cache dependency map. Keys include the
trusted organization, operation, hashed parameters, user, role and sorted effective
permissions. User-specific job views and permission-dependent dashboards cannot
reuse another viewer's response. Never pass a client organization selector as a
cache scope. Without a scope, tenant reads bypass caching.

| Cached data | TTL | Invalidated by |
| --- | --- | --- |
| Customer lists/details and request customer choices | 5 minutes | Customer create/update/archive/restore |
| Request lists/details | 5 minutes | Request, customer, job or service-type changes |
| Job lists/details/filter metadata/staff choices | 5 minutes | Job, request, customer, service-type, invoice, user or role changes |
| Invoice lists/details | 5 minutes | Invoice, payment or customer changes |
| Service-type lists | 5 minutes | Service-type create/update/archive |
| User lists and role dropdowns | 5 minutes | User/profile, role or permission-assignment changes |
| Organization branding settings | 5 minutes | Settings edits, uploads/removal or platform tenant-status changes |
| Eligible upgrade plans and platform plan catalog | 5 minutes | Plan/subscription changes; eligible choices also refresh after seat/role changes |
| Tenant dashboard | 30 seconds | Customer, request, job, invoice/payment, service-type, user or role changes |
| Platform dashboard | 30 seconds | Platform transactions and tenant user/profile/seat changes |

Authorization always runs before a cache lookup where a service has its own
guard. Authentication middleware still reloads account state, tenant access and
effective permissions on every protected request. Mutation validation uses live
database queries, including user existence, invoice balances and seat limits.

Auth/session/profile responses, user/role/permission administration details,
audit logs, feedback/consent access, signup review/counts, subscription entitlement
summaries, platform tenant/user/payment/subscription lists, CSV exports and public
asset-access checks remain live. Monitoring retains its existing short health-probe
cache, with live traffic information. Public branding assets keep their existing
HTTP cache headers.

`invalidating(source, work)` advances affected cache generations only after work
commits successfully. Tenant writes invalidate that tenant's projections; shared
platform changes advance global generations where necessary. A fetch started
before invalidation may finish for its original caller, but cannot refill the
generation used by subsequent reads. Old generation entries expire normally.
Invalidation is best effort during Redis outages; TTL bounds stale cached data
after recovery. Raw database edits and external writers must invalidate affected
resources explicitly or wait for TTL.

Tests: `npm test -- --runInBand tests/cache`. Existing business-rule unit suites
use cache pass-through doubles; the cache suites exercise real cache code and
services with isolated in-memory Redis/database adapters.
