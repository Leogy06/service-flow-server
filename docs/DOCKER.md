# Application container images

The complete single-VPS setup is now `../../deploy/compose.yml` with instructions
in `../../deploy/README.md`. From this backend directory, run
`npm run test:predeploy:vps` to build and exercise it in a fresh isolated test
project. The empty legacy `docker-compose.yml` in this directory is not used.
The VPS file supplies production origins, private MySQL/Redis networking,
persistent volumes and a Caddy HTTPS proxy. Keep development env files unchanged.
`TRUST_PROXY_HOPS=1` is only appropriate for that single proxy with the API port
unpublished; its default is 0 for direct local connections. Caddy replaces
client-supplied forwarded headers before they reach Express and the Redis limiters.

Runtime security patches retain the current Prisma major version. The MariaDB
connector is overridden to 3.5.4 because the adapter pins an older vulnerable
connector; review this override when updating the adapter. Production API image
dependency installation excludes the migration CLI and its optional/peer tools.

Build from the `service_flow` project root with Docker Desktop using Linux containers:

```powershell
docker build --target runtime -t serviceflow-backend:local ./backend
docker build --target migrate -t serviceflow-migrate:local ./backend
docker build -t serviceflow-frontend:local ./frontend
```

Each folder is its own build context. Node 24 Debian slim is shared across build
and runtime stages. Both applications run as the unprivileged `node` user. Host
node_modules, generated Prisma code, environment files, logs and uploads are
excluded; Linux dependencies and Prisma output are generated inside the build.
Prisma migration SQL stays in the build/migration image. API runtime keeps compiled
code and production dependencies. The migration CLI runs only in the separate
`migrate` target; application startup does not apply schema changes automatically.

## Backend runtime

The Dockerfile's `DATABASE_URL=mysql://127.0.0.1:3306/build_only` exists only for
Prisma code generation during image building. It is not your application's runtime
database configuration and does not need replacing with credentials.

A file named `.env.docker` is not loaded automatically. Pass it at runtime using
`docker run --env-file`, or reference it with Compose's `env_file`. It must contain
the complete required backend environment, not only DATABASE_URL. The application
uses DATABASE_* fields for its connection and DATABASE_URL for migration commands;
these must agree. Keep `.env.docker` private and ignored by Git and Docker builds.

To check just its required variables against the existing image, from project root:

```powershell
docker run --rm --network none --env-file ./backend/.env.docker --entrypoint node serviceflow-backend:local --input-type=module -e "await import('./dist/config/env.js'); console.log('Environment schema OK')"
```

This imports only the environment validator, with networking disabled. Passing it
does not prove MySQL/Redis connectivity or a working Compose deployment. Hostnames
such as `mysql` require running containers on a shared user-defined Docker network.

The already-executed image smoke checks are reproducible from project root with
`node artifacts/docker-20261018/smoke.mjs`. They use private test Redis and sample
API data, not your new `.env.docker` or an actual MySQL database. The complete
Compose/proxy/database deployment remains a separate check.

Inject the backend's existing required environment values at container startup,
using a private environment file or Compose configuration. Never pass production
secrets as build arguments or COPY environment files into an image.

`DATABASE_URL` is used by the migration CLI; runtime `DATABASE_HOST`,
`DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME` must point
to that same database. In a private Docker network use service names such as
`mysql` and `redis`, rather than localhost. Configure the existing REDIS_URL and
an exact HTTPS CORS_ORIGIN for the real app. The build-only DATABASE_URL is a
noncredential placeholder and is never used to connect to a database.

Compose must mount named volumes at `/app/storage/branding` for persistent
branding uploads and `/app/logs` for file logs. Directories are writable by the
image's node user (UID 1000); host bind mounts need matching permissions. Existing
log retention remains controlled by LOG_MAX_FILES; Docker stdout retention needs
its own logging configuration. MySQL and Redis need their own persistence and
memory configuration. Initialize the NEW Linux MySQL database with
lower_case_table_names=1 before its first startup, as verified by predeploy tests.

## Frontend build and runtime

The image uses Next standalone output, with public/static assets copied explicitly.
The existing next-themes postinstall patch is included before npm ci runs.
NEXT_PUBLIC_API_URL is a build argument and defaults to `/api`. Changing it requires
rebuilding the frontend image. A reverse proxy must route `/api/...` to backend:4000
without stripping `/api`, and other website paths to frontend:3000.

Server-rendered public business pages use INTERNAL_API_URL, defaulting to
http://backend:4000/api. Both containers must share a private Docker network where
the API service is named `backend`. This variable is server-only and can be
overridden at startup. SITE_URL must be the canonical public origin; it defaults
to https://serviceflowph.com and can be overridden at build and runtime as needed.

Legal pages are static. Supply accurate public contact values as build arguments:
SERVICE_FLOW_LEGAL_NAME, SERVICE_FLOW_BUSINESS_ADDRESS, SERVICE_FLOW_SUPPORT_EMAIL,
SERVICE_FLOW_PRIVACY_EMAIL. Empty defaults preserve the current draft/contact
fallback behavior; they do not make legal content ready for launch. For example,
add `--build-arg SERVICE_FLOW_SUPPORT_EMAIL=your-real-support-address` to the build.
Do not put private credentials in these public values.

## What comes next

These files build images; they do not configure or expose a complete deployment.
Next prepare Compose, private service networking, named volumes, the one-shot
migration service, Redis/MySQL limits, and Caddy HTTPS/proxy rules. Publish only
the proxy ports on the VPS. EXPOSE does not publish a port. Start the migration
image only against the intended backed-up database; do not mount local `.env`
files as part of the build context. Test the full stack, sessions, persistence,
backup restore and email delivery before inviting clients.
