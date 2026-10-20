# Catalog and development seeds

`development.ts` and `../seed-development.ts` provide the complete, local-only
sample workspace with `npm run seed:dev` (preview) and `npm run seed:dev -- --apply`.
They use `DEV_SEED_PASSWORD` for new accounts and combine the shared catalog and
Bright Star transaction helpers with organizations, roles, accounts, settings,
independent tenant workflows and platform billing fixtures in one transaction.
See [development setup and account list](../DEVELOPMENT_SEED.md). Existing data is
preserved; no reset or automatic migration runs.

## Minimal production setup

`production.ts` and `../seed-production.ts` provision only global `Permission`
definitions and the operator-supplied system administrator, plus its required
organization-less role and platform audit records. No plans, organizations,
subscriptions or sample business data are created. Existing permission grants
are unchanged. The platform identity uses `platformRole=SYSTEM_ADMIN`, not a
tenant role permission.

From `backend`, with development dependencies installed:

```sh
npm run seed:prod -- --dry-run
npm run seed:prod -- --apply
```

Default mode is a read-only dry run. The CLI prints the hostname, port and database
from `DATABASE_URL`, never credentials. The command selects `.env.production` and
requires `SYSTEM_ADMIN_EMAIL`, `SYSTEM_ADMIN_PASSWORD` (14–72 bytes) and
`SYSTEM_ADMIN_REASON` (10–1000 characters) through private configuration. Apply
requires the wrapper's existing `production` confirmation. Apply existing
migrations first; the seed runs no migration or reset. See `../../docs/ENVIRONMENT.md`.

Apply creates missing definitions and the operator in one serializable transaction.
Audit failures roll back the entire setup. Reruns preserve an existing active
organization-less system administrator and its password. Tenant email collisions,
disabled identities and tenant-owned catalog names abort without promoting,
reactivating or overwriting anyone. Concurrent conflicts fail safely; rerun.
Production apply invalidates the platform dashboard cache after commit.

The standalone compiled `bootstrap:system-admin` remains available for provisioning
a separate additional operator; it retains duplicate-email rejection. Create
production plans manually through platform administration when ready.

## Development catalog only

`catalog.ts` and `../seed-catalog.ts` retain the global permissions and six proposed
PHP plans for development: `npm run seed:catalog -- dev --apply`. The wrapper and
catalog CLI reject production catalog seeding. Full `seed:dev` still includes
these catalogs. Existing descriptions, prices and retired plans are preserved.

`PlatformSettings` is configuration with existing runtime defaults, not a catalog;
configure payment instructions, contacts and default plan through platform admin.
Enums are schema values and require no rows. Tenant approval provisions role
defaults. Do not use `seed:roles`, `seed:admin` or sample seeds for production setup.
Service types require tenant-specific services and prices.

Source seed CLIs require `tsx` and the generated Prisma client. In Docker, use
the existing `migrate` build target, which includes source and development tools;
the minimal API runtime image does not include this CLI. Container build targets
omit local scripts, so invoke `node --import tsx prisma/seed-production.ts` directly
there with explicit NODE_ENV and injected DATABASE_URL/REDIS_URL; the npm mode
wrapper is intended for the local checkout.
