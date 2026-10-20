# Production catalog seeds

`catalog.ts` and `../seed-catalog.ts` provision only global `Permission` definitions
from `src/constants/permission.constants.ts` and the six existing PHP subscription
plans from `plans.ts`. They never create organizations, accounts, subscriptions,
customers, jobs, invoices, payments, service types, roles or permission grants.

From `backend`, with development dependencies installed:

```sh
npm run seed:catalog -- prod --dry-run
npm run seed:catalog -- prod --apply
```

Default mode is a read-only dry run. The CLI prints the hostname, port and database
from `DATABASE_URL`, never credentials. This single URL controls application,
seed and migration connections. The wrapper requires explicit `dev` or `prod`;
production apply also requires typing `production`. Apply existing migrations before seeding. No migration
or reset runs during seeding. See `../../docs/ENVIRONMENT.md`.

Apply creates missing entries and platform operator audit records in a single
serializable transaction. Audit failures roll back the entire catalog. Concurrent
conflicts fail safely; rerun the command. Existing descriptions, prices, seat
limits and retired plans are preserved. A catalog permission name already owned
by a tenant aborts the operation; ownership must be reviewed separately.

The command invalidates existing plan/dashboard/upgrade-choice caches after apply,
including no-op retries. Shared cache handling logs Redis failures and falls back
to the existing five-minute TTL. No permission grants change, so no authorization
cache reset is needed.

`PlatformSettings` is configuration with existing runtime defaults, not a catalog;
configure payment instructions, contacts and default plan through platform admin.
Enums are schema values and require no rows. Tenant approval provisions role
defaults; system-admin bootstrap is a separate explicit command. Do not use
`seed:roles`, `seed:admin` or sample seeds as a production catalog substitute.
Service types require tenant-specific services and prices.

This source CLI requires `tsx` and the generated Prisma client. In Docker, use
the existing `migrate` build target, which includes source and development tools;
the minimal API runtime image does not include this CLI. Container build targets
omit local scripts, so invoke `node --import tsx prisma/seed-catalog.ts` directly
there with explicit NODE_ENV and injected DATABASE_URL/REDIS_URL; the npm mode
wrapper is intended for the local checkout.
