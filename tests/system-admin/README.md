# Platform billing verification

`billing-policy.test.ts` checks monthly/yearly calendar boundaries, 14-day trial expiry, exact decimal money,
manual transition restrictions and entitlement expiration/grace policy.
`billing-schema.test.ts` checks sensitive confirmation/evidence, strict input and
partial-plan updates. `user-seats.test.ts` covers creation, invitation reservations,
restoration, deletion, and the three-user boundary; the invite-acceptance suite
covers activation without double counting reservations. Access-management tests
cover invitation-route conflicts, tenant ownership and permissions.
`billing.test.ts` checks service behavior against an in-memory repository. Its
transaction queue models serialized execution; it does not prove MySQL locking.
Refund cases cover request/review/completion transitions, request/completion retry
keys, rejection/resubmission and atomic rollback. `refund-routes.test.ts` uses the
actual auth/platform guards and rate-limit middleware with in-memory test storage
to check tenant denial, per-operator limits and 429 Retry-After headers.

`trials.mysql.mjs` checks concurrent one-time grants, real authenticated access
before/after expiry, administrator-only trial mutations, zero trial revenue,
expiration alert deduplication, paid conversion and refund behavior. It runs with
the other MySQL suites through `scripts/run-platform-mysql-tests.mjs` against an
explicit isolated test database; fixtures and immutable audits are retained.

Run the focused Jest suites after implementing the billing modules:

```powershell
npm test -- --runInBand tests/system-admin tests/auth/set-password.test.ts
```

For real transaction and constraint behavior, provision a separate disposable
MySQL database whose name contains an underscore-delimited `test` segment, such
as `service_flow_platform_test`. Point both `DATABASE_URL` and the individual
adapter database variables at that same database. Apply the reviewed migration
there before running the test. No migration is applied by the harness.

```powershell
$env:PLATFORM_TEST_DATABASE_NAME = 'service_flow_platform_test'
$env:RUN_DB_PLATFORM_TESTS = '1'
$env:NODE_ENV = 'test'
$env:LOG_LEVEL = 'error'
node --import tsx tests/system-admin/mysql.integration.mjs
```

The harness checks concurrent payment verification/refunds and concurrent seat
activation/invitation reservations, history uniqueness, separate gross/refund totals and append-only
platform audit triggers. Its unique fixtures remain in the disposable database
because platform audit rows must be immutable. It never resets a database or
removes fixtures. Never run it against a development, staging or production
database that contains records you need to retain.
