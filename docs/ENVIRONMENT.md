# Backend environments and launcher

For the short production build/start checklist, see the
[backend README](../README.md#production).

Use Node 24 and Bash (Git Bash/WSL on Windows). Configure private
`backend/.env.development` and `backend/.env.production` using `.env.example`.
All required blank values must be filled. Existing files/values are not replaced.
`DATABASE_URL`, `CORS_ORIGIN`, both JWT secrets, `RESEND_API_KEY` and
`EMAIL_FROM` are required; the example lists all supported settings and defaults.
`REDIS_URL` defaults to `redis://localhost:6379` for local development. Production
requires an explicit verified `rediss://` connection URL and rejects the local default.

From `backend`:

```sh
./scripts/run.sh dev    # or npm run dev:all
./scripts/run.sh prod   # or npm run prod:all
```

The scripts resolve their own directory, so an absolute/relative path to the
script also works from elsewhere. Legacy `dev.sh` / `prod.sh` delegate to it.
This launches the backend plus its development services; run the frontend with
its existing `npm run dev` command separately.

`src/config/env-file.ts` loads the selected file, defaults NODE_ENV to development,
and gives injected environment variables priority in every mode. Test mode uses
development defaults with explicit isolated-test values taking priority. There is
no fallback to the old `.env`. Environment-only container deployments need no file;
the launcher deliberately requires one. `env.ts` validates before app startup and
reports key names/problems without values. `env-schema.ts` defines the typed
contract. Production defaults to info logs, HTTPS CORS, verified MySQL TLS and
`rediss://` Redis. Refresh-cookie security uses this same validated NODE_ENV.

Env files are sourced by Bash before Prisma commands: use `KEY='value'` syntax,
quote spaces, `$`, `#` and `&`, and do not use dotenv-only syntax or expansions.
URL-encode special characters in database/Redis credentials separately. For
example, `@` becomes `%40`, `#` becomes `%23`, and `$` becomes `%24`. Do not enable
shell tracing when loading secrets.

## Development

The backend runs locally through Node. Start your existing local MySQL service
and set DATABASE_URL to its actual database, account and port, for example
`mysql://USER:YOUR_LOCAL_PASSWORD@127.0.0.1:3306/service_flow_dev?connection_limit=5`.
The launcher does not install, start or provision MySQL. There is no requirement
to use root or port 3307; separate DATABASE_* settings are ignored.

After the schema is available, `npm run seed:dev` previews a full local sample
workspace. Set `DEV_SEED_PASSWORD` in `.env.development`, then run
`npm run seed:dev -- --apply` to add it. This explicit development command refuses
remote/production databases and preserves existing records on reruns. Account
emails, fixture coverage and billing behavior: [development seed](../prisma/DEVELOPMENT_SEED.md).

Set `REDIS_URL=redis://127.0.0.1:6379`. Docker is used only for Redis; Compose is
not required. The launcher creates or starts its `serviceflow-dev-redis` container
using Redis 7 Alpine, binds port 6379 to loopback, stores data in the named volume
`serviceflow-dev-redis-data`, and waits for Redis to respond before continuing.
An existing container with that name must carry the launcher's identifying label.
Stop other local Redis services if port 6379 is occupied.

Missing build dependencies trigger `npm ci --include=dev`; it then runs generate,
migrate dev against your configured local MySQL, and `tsx watch`. Development
mode refuses remote DB/Redis targets. `migrate dev` can prompt for migration names
or drift resolution; never approve a reset of data you need. The launcher never
resets or drops data automatically.

Ctrl+C stops the API; Redis and its data remain. To stop Redis without deleting data:

```sh
docker stop serviceflow-dev-redis
```

## Production

Use the actual remote Freehostia host/database, URL-encoded credentials,
`connection_limit=5&sslaccept=strict`, the Upstash TCP URL
`rediss://default:URL_ENCODED_PASSWORD@ENDPOINT:6379`, an exact HTTPS frontend
origin, separate strong JWT secrets, and verified email credentials. Loopback
database addresses and socket URLs are rejected. Configure trusted proxy hops
only for the deployment's actual proxy topology.

The existing Prisma 7 MariaDB adapter is retained. `database.ts` maps URL pool
and SSL options to its driver options, including verified TLS in production.
If the provider requires a custom root CA, append `&sslcert=../certs/server-ca.pem`;
paths are relative to `backend/prisma`. Prisma config converts the CA path to an
absolute path before passing it to the native engine, matching the runtime adapter
and avoiding working-directory differences on Windows. Private env files stay
unchanged. Supported URL options are `connection_limit`, `sslaccept=strict`, `sslcert` and development
`socket`. Never disable certificate verification. See the official
[Prisma MySQL connector](https://docs.prisma.io/docs/orm/v7/core-concepts/supported-databases/mysql)
and [Prisma 7 pool settings](https://docs.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/databases-connections/connection-pool).

Confirm the database provider allows connections from the backend host, supports
verified TLS, and grants the DDL/trigger privileges required by existing migrations. Those
hosting capabilities have not been verified. This runner uses no Docker in prod.
It installs locked build dependencies, generates Prisma, builds, requires typing
`production`, runs **only migrate deploy**, prunes build dependencies, and starts
`dist/index.js`. Cancelling the prompt applies no migrations and starts no app.
Use a process manager/service for restart policies. Build tools are installed
temporarily because TypeScript/Prisma are dev dependencies; the final installation
contains runtime dependencies. Stop the local dev server before prod reinstalls
packages, especially on Windows where esbuild can hold executable locks.

## Prisma and seeds: choose the environment explicitly

Use the wrappers from backend; they resolve files relative to the backend even
when the script is invoked by an absolute path from another directory:

```sh
npm run prisma:dev -- migrate status
npm run prisma:dev -- migrate dev --name add_job_field
npm run prisma:dev -- migrate reset
npm run prisma:dev -- db seed
npm run prisma:dev -- generate
npm run prisma:dev -- studio

npm run prisma:prod -- migrate status
npm run prisma:prod -- migrate deploy
npm run studio:prod
npm run seed:prod -- --dry-run
npm run seed:prod -- --apply
```

Development wrappers and the dev launcher explicitly apply .env.development,
replacing inherited DB/Redis settings, and require local MySQL. Production uses
.env.production defaults with real injected environment variables taking priority.
The wrapper prints the selected mode, file, host, port and database without
credentials before executing. Config/schema/URL override flags are blocked so
commands cannot silently change that target. No manual sourcing is needed for
these wrappers. Direct npx prisma commands still inherit the shell environment;
use the wrappers for manual database work.

Production migrate deploy, seed:prod --apply and Studio require typing production.
Reset, migrate dev, db push/execute and tenant/sample seeds are blocked in prod.
The default db seed updates tenant role permissions, so production uses the
separate seed:prod command for global permissions and the system administrator
only, with the required global role and audit records. No plan or tenant data is
seeded in production. Configure SYSTEM_ADMIN_EMAIL, SYSTEM_ADMIN_PASSWORD
(14–72 bytes) and SYSTEM_ADMIN_REASON privately. Existing active platform admins
and credentials are preserved; tenant identities are never promoted. The catalog
and plan seeds are restricted to development. Dry runs and read-only commands
need no confirmation. An explicit dev
reset still asks Prisma's normal destructive-operation confirmation and erases
all data in the chosen development database; seeds run separately.

### Prisma Studio for production

From `backend/`, run:

```sh
npm run studio:prod
# Optional: choose the port and avoid opening a browser automatically.
npm run studio:prod -- --port 5555 --browser none
```

Check the displayed production target, then type `production`. This uses the same
`.env.production` selection, injected-variable precedence and database validation
as `prisma:prod`. Open the localhost URL printed by Studio; press Ctrl+C in that
terminal to stop it. No migrations or seeds run when starting Studio. Studio can
edit production records; it is not a read-only database viewer.

The installed Studio MySQL driver ignores the `sslcert` URL option. The wrapper
resolves that CA file relative to `backend/prisma` and passes its absolute path
through `NODE_EXTRA_CA_CERTS` before starting Studio. This lets Node trust the
provider's CA while `sslaccept=strict` continues to enforce certificate verification.
The selected database CA takes precedence over an inherited `NODE_EXTRA_CA_CERTS`
for the Studio child only. Your shell and env files are unchanged. Studio may still
warn that `sslcert` is ignored; the CA is supplied separately through Node.
If you see `self-signed certificate in certificate chain`, stop Studio and restart
with `npm run studio:prod`; confirm `sslcert` references your provider's correct CA.
Do not disable TLS verification. UI startup alone does not verify database access.
Studio requires the backend development dependencies (including Prisma CLI),
which the production launcher prunes after building.

Existing npm shortcuts now require the mode argument too:

```sh
npm run prisma:generate -- dev
npm run prisma:migrate -- dev --name add_job_field
npm run prisma:deploy -- prod
npm run seed:roles -- dev
npm run seed:customers -- dev
npm run seed:plans -- dev
npm run seed:bright-star -- dev --dry-run
```

`seed:dev` and `seed:prod` select their named environment; other seed shortcuts
require an explicit permitted mode (`npm run seed:NAME -- dev [flags]`). Seeds use the
shared Prisma singleton and selected DATABASE_URL/REDIS_URL. No seed runs
automatically. CLI/seed commands need development tools installed; the production
launcher prunes them. The internal generate/prod:build hooks remain low-level
build commands, so container builds can generate code with an injected build-only
URL and no private env files. They do not modify a database. The backend launcher
already sources/validates its mode, then invokes the local Prisma binary directly
with its existing production confirmation.

The older `deploy/compose.yml` assumes private non-TLS MySQL and socket migrations;
the production restrictions require adapting that deployment before reuse.
Older predeploy probes intentionally simulate production against local services
and fail the remote/TLS checks; they are not certification for this
remote Freehostia deployment.
