# Production catalog seeds

`catalog.ts` and `../seed-catalog.ts` provision only global `Permission` definitions
from `src/constants/permission.constants.ts` and the six existing PHP subscription
plans from `plans.ts`. They never create organizations, accounts, subscriptions,
customers, jobs, invoices, payments, service types, roles or permission grants.

From `backend`, with development dependencies installed:

```sh
npm run seed:catalog -- --dry-run
npm run seed:catalog -- --apply
```

Default mode is a read-only dry run. The CLI prints the actual adapter target
(`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`), never credentials. These
variables control application/seed connections; `DATABASE_URL` controls Prisma
migrations. Ensure both configurations refer to the intended database and apply
existing migrations before seeding. No migration or reset runs during seeding.

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
the minimal API runtime image does not include this CLI.
