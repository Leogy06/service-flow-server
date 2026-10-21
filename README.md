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

## Other instructions

- [Environment files, development startup and Prisma commands](docs/ENVIRONMENT.md)
- [Production operator provisioning and development seeds](prisma/seeds/FEATURE.md)
- [Upstash Redis configuration](docs/UPSTASH.md)
- [Container deployment notes and legacy deployment limitations](docs/DOCKER.md)
