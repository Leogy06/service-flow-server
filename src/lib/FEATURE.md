# Shared runtime infrastructure

`demo-guard.ts` reloads the persisted organization mode inside protected service
operations. Demo tenants receive `403 DEMO_ACTION_DISABLED` for customer payments,
staff creation/invitations, feedback dispatch and subscription financial mutations.
Missing tenants and failed mode reads fail closed. The flag is never accepted from
the request. Demo owners still complete ordinary invitations and email login
verification; internal customer/request/job/invoice workflows remain available.

Prisma and Redis clients are shared per warm runtime. The standalone entrypoint
owns process signals through `shutdown.ts`: stop accepting HTTP requests, drain
active work, close both clients and exit. Repeated signals share one shutdown.
The entire drain/cleanup has a ten-second deadline and exits unsuccessfully on a
timeout or cleanup failure. Driver exception details are never logged here.

Vercel workers do not install process signal handlers; their lifetime belongs to
the provider. `/api/health` remains lightweight liveness, not database readiness.
Use independent dependency checks and real restore exercises for availability
acceptance. Runtime tests are in `tests/config/shutdown.test.ts`.
