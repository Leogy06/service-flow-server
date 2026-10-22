# Service Flow backend

Production startup and build commands are below. The detailed guide already lives
in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md), including development setup and
Prisma database selection.

## Production

Run commands from `backend/` using Bash (Git Bash or WSL on Windows), with Node 24
and npm installed.

Configure your existing `.env.production` using [.env.example](.env.example) as a
reference. Do not overwrite existing values. Production requires remote MySQL
with verified TLS (`sslaccept=strict`), an Upstash `rediss://` URL, an exact HTTPS
frontend origin, JWT secrets and email settings. Injected environment variables
take priority over the production file. See the
[production configuration guide](docs/ENVIRONMENT.md#production) for details.

### Build, migrate and start with one command

```bash
npm run prod:all
```

This calls `scripts/run.sh prod`: installs locked build dependencies, validates
configuration and displays the database target without credentials, generates
Prisma, builds `dist/`, asks you to type `production`, applies pending migrations,
prunes build dependencies, then starts the compiled app. It starts no Docker
containers and runs no seeds. Check the displayed database before confirming.

The existing `./scripts/prod.sh` is an alias for the same launcher.

If the build reports missing Prisma members such as `platformAlert` with a
suggestion of `platformalert`, check the application schema and regenerate the
client. The models, enums and relation fields must match the application, and
table names must match the migrations. A database introspection can overwrite
these names and remove Prisma-managed defaults. See the
[schema and migration rules](prisma/migrations/FEATURE.md). This compile error
occurs before the launcher's migration step; resetting the database does not
repair the client contract.

### Run the steps separately

```bash
export NODE_ENV=production
npm ci --include=dev
npm run prisma:prod -- generate
npm run build
npm run prisma:prod -- migrate status
npm run prisma:prod -- migrate deploy
npm prune --omit=dev --omit=peer --omit=optional --ignore-scripts
npm start
```

`migrate deploy` displays the selected target and requires typing `production`.
For optional first-time operator/permission setup, follow the
[production seed instructions](prisma/seeds/FEATURE.md#minimal-production-setup)
before pruning; seed and Prisma commands require development tools.

### Start an existing build

With `dist/` and runtime dependencies already present, use this in a fresh shell:

```bash
NODE_ENV=production npm start
```

Set `NODE_ENV` explicitly: plain `npm start` otherwise defaults to development
when the shell does not already select a mode. Starting an existing build does
not install dependencies, build, migrate or seed. Use your host's service/process
manager for restarts; the launcher itself runs in the foreground.

## Vercel backend deployment

Select `backend` as the Vercel project Root Directory when importing the full
repository. If the Git repository contains only this backend, use its root.
The committed [vercel.json](vercel.json) selects the Express framework, installs
build dependencies and runs `npm run prod:build` (Prisma generation, seed/config
type-checking and the API TypeScript build). The seed check does not execute seeds
or contact the database. Remove any dashboard override that still runs `npm run prod:all`.
Keep Output Directory at the Express preset default; `dist` is not a static site.
Vercel uses the default Express export in `src/app.ts` as its entrypoint.

Set these in **Project Settings > Environment Variables** for the deployment's
environment, then redeploy:

- `NODE_ENV=production`
- `DATABASE_URL` with the remote MySQL endpoint and `sslaccept=strict`
- `REDIS_URL` with the Upstash `rediss://` connection URL
- `CORS_ORIGIN` with the exact HTTPS frontend origin (no trailing slash)
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- `RESEND_API_KEY` and `EMAIL_FROM`

Enter raw values without Bash quote delimiters. Add any other required settings
from [.env.example](.env.example). A custom `sslcert` path must refer to a CA file
available inside the deployment, not a path on your computer. Environment-only
startup does not require `.env.production`; keep private env files out of Git.

`prod:all` is for a persistent Node host: it requires a local env file, prompts
for migration approval and starts a foreground server. Run production migrations
separately through the existing guarded Prisma commands, using the same database
as the deployment. The Vercel build does not migrate or seed.

Branding uploads currently use local filesystem storage. Vercel Functions have a
read-only filesystem outside temporary scratch space, so durable branding uploads
require shared storage before using that feature there. Configure trusted proxy
hops only after verifying the deployed proxy path; the diagnostic setting is
documented in [.env.example](.env.example).

References: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express),
[environment variables](https://vercel.com/docs/environment-variables) and
[function filesystem support](https://vercel.com/docs/functions/runtimes#file-system-support).

## Other instructions

- [Environment files, development startup and Prisma commands](docs/ENVIRONMENT.md)
- [Production operator provisioning and development seeds](prisma/seeds/FEATURE.md)
- [Upstash Redis configuration](docs/UPSTASH.md)
- [Container deployment notes and legacy deployment limitations](docs/DOCKER.md)
