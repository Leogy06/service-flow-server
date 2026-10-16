# Platform billing verification

`billing-policy.test.ts` checks annual calendar boundaries, exact decimal money,
manual transition restrictions and entitlement expiration/grace policy.
`billing-schema.test.ts` checks sensitive confirmation/evidence, strict input and
partial-plan updates. `user-seats.test.ts` covers direct creation and restoration;
the invite-acceptance suite covers activation at the seat boundary.
`billing.test.ts` checks service behavior against an in-memory repository. Its
transaction queue models serialized execution; it does not prove MySQL locking.

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
activation, history uniqueness, separate gross/refund totals and append-only
platform audit triggers. Its unique fixtures remain in the disposable database
because platform audit rows must be immutable. It never resets a database or
removes fixtures. Never run it against a development, staging or production
database that contains records you need to retain.
