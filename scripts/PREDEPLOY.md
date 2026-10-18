# Local predeployment runner

From `backend`, run `npm run test:predeploy` (PowerShell: `npm.cmd run test:predeploy`).
Keep `frontend` next to `backend`, install both projects' dependencies beforehand,
start local MySQL/Redis and Docker Desktop using Linux containers, and stop the
frontend dev server and any concurrent frontend build: they share `.next` output.
The backend dev server can keep running; HTTP probes use random ports.
The backend smoke server listens according to the existing app's bind
configuration; run this on a trusted development machine.

The command runs runner safety tests; Prisma generation; backend/frontend lint,
TypeScript, unit tests and production builds; production environment validation;
compiled Prisma/Redis connectivity; read-only configured migration status; real
compiled API startup (health and unauthenticated denial); optimized Next startup;
and fresh Linux MySQL 8.4 migration replay with `lower_case_table_names=1`.

It reuses package scripts and installed dependencies without installing/pruning them.
Reports and sanitized command logs are in ignored `backend/.predeploy/<run>/`.
Exit **1** means at least one failure; **2** means checks are blocked; **0** means all
included checks passed. Missing Docker configuration and unverified deployment
acceptance are explicitly BLOCKED, so the current runner alone cannot certify launch.
While checks are executing the report shows RUNNING and JSON exitCode is null;
wait for the final terminal summary before treating a report as complete.
`npm run test:predeploy -- --skip-linux` runs without the Linux replay, recorded as
BLOCKED. `npm run test:predeploy:runner` tests the runner's safety/reporting helpers.

For the DigitalOcean VPS configuration, run `npm run test:predeploy:vps` instead.
This keeps development env files unchanged, supplies the planned public values
(`/api` and `https://serviceflowph.com`), then builds and starts `../deploy/compose.yml`
in a unique test project with fresh volumes and random test-only credentials.
It tests actual migration/API/frontend images, verified local-CA HTTPS,
database-backed login, cookie rotation/logout, Redis rate limiting and persistence.
VPS-mode database/Redis/startup checks target only this Compose stack; separately
running native MySQL/Redis services are not required or contacted. Default mode
retains the original read-only configured-local-database checks.
See `deploy/README.md` from the project root. Public DNS, real email and VPS
capacity still need live acceptance, so exit 2 can remain even when all executable
checks pass. No external production credentials are created.

## Configuration and safety

- Backend `.env` is read with inherited environment variables taking precedence.
  Production validation uses the actual values with `NODE_ENV=production`.
  Runtime diagnostics separately default missing `LOG_LEVEL` to `info`; this does
  not turn a failed environment check into a pass.
- Frontend build and environment validation use Next's production environment
  files. For the planned proxy, set `NEXT_PUBLIC_API_URL=/api` and
  `SITE_URL=https://serviceflowph.com` in the appropriate production environment.
  The runner never edits environment files. A relative API URL still needs the proxy.
- Configured DB operations are read-only. Both MySQL connection configurations must
  match and MySQL/Redis must be loopback addresses. No remote services are probed.
- Redis uses a unique 30-second diagnostic key and deletes it afterward. The API
  health/auth probes also exercise local rate-limit counters.
- Only the fresh, randomly named, loopback-published Docker MySQL database receives
  `prisma migrate deploy`. The configured application database is never migrated,
  seeded, reset or dropped. The test container is stopped in `finally`; its data
  is retained and its name recorded. Each complete run consumes additional disk.
  Test credentials are randomly generated and redacted from logs; Docker metadata
  contains those isolated credentials, so reports should still be treated as local.
- No invitations/emails, fixture business-flow tests, dependency pruning, or paid
  cloud resources are involved. Builds replace generated `dist`/`.next` output.
- Full app-image/Compose/proxy tests, HTTPS sessions, browser business workflows,
  email delivery, upload/data persistence, backup restore and VPS memory/load tests
  remain separate acceptance work. A successful static health endpoint alone does
  not prove database readiness; connectivity and migration checks are separate.

If interrupted, check the report for an isolated container that needs stopping.
No existing containers/volumes are removed automatically.
