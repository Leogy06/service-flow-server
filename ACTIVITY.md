## [2026-10-22 06:48] Codex

- **Task:** Diagnose the backend Vercel deployment failing on missing .env.production.
- **Summary:** Traced prod:all to its intentional local-file guard, interactive migration prompt and persistent startup. Added Express Vercel config using build-only prod:build, a default app export, and deployment/environment instructions; kept the existing server launcher intact.
- **Files changed:** vercel.json, src/app.ts, README.md; root/backend ACTIVITY.md.
- **Endpoints / rate limiting:** N/A; no route, limiter, frontend, schema, migration, database-record, API contract or permission changes.
- **Status:** Completed locally; hosted deployment unverified. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Backend prod:build, lint, 60 focused environment/logging tests and diff checks passed. Initial generation hit sandbox EPERM in Prisma's external engine cache; approved rerun passed with a placeholder database URL. No migrations, seeds, production connections or deployment performed; private env files unchanged. Set Vercel environment variables and root, remove prod:all dashboard override, commit local files and redeploy. Existing filesystem branding uploads require shared storage on Vercel.

## [2026-10-22 06:37] Codex

- **Task:** Diagnose the missing production email brand image and fix delivery.
- **Summary:** Confirmed the public logo URL returns HTTP 200/image/png; replaced the remote image dependency with a bundled approved PNG and matching Resend CID attachment. Updated shared template safety/delivery regression tests and email docs.
- **Files changed:** src/lib/email/{branding.ts,send-invite.ts,templates/layout.ts,FEATURE.md}, tests/email/{templates.test.ts,send-invite.test.ts}; root/backend ACTIVITY.md.
- **Endpoints / rate limiting:** N/A; no frontend, database, migration, API or permission changes.
- **Status:** Completed locally. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Six regressions failed before the fix; all 47 backend suites/1083 tests, lint, build, compiled-logo smoke check and diff checks passed. Restored existing locked dev dependencies offline with lifecycle scripts disabled. No deployment or emails sent; a fresh production invitation must confirm mailbox rendering. Exact cause in the old received email remains unverified; CID removes remote-fetch reliance. Reset delivery remains an existing placeholder; future senders must attach the shared PNG. Raw HTML browser previews require substituting its data URL.

## [2026-10-22 06:26] Codex

- **Task:** Diagnose and repair the TypeScript errors reported during npm run prod:all.
- **Summary:** Reproduced all 356 errors and traced the incompatible lowercase schema to commit c79a906. Restored the preceding application schema, including model/enum/relation names, cuid defaults and updatedAt behavior; regenerated Prisma with a placeholder test URL. Added schema-to-migration table-casing regression coverage and troubleshooting guidance.
- **Files changed:** prisma/schema.prisma, tests/prisma/migrations.test.ts, prisma/migrations/FEATURE.md, README.md; root/backend ACTIVITY.md. Generated client/build artifacts refreshed locally.
- **Endpoints / rate limiting:** N/A; backend schema/client contract restoration only. No frontend, migration SQL, API, permission or database-record changes.
- **Status:** Completed local repair. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** New regression failed before repair (72 passed/1 failed). After repair, backend build, all 46 Jest suites/1079 tests, lint and diff checks passed. Production launcher fails during build before its migration confirmation. No database connections, migrations, seeds, reset, production startup or deployment performed; live database/runtime acceptance remains unverified. Retry npm run prod:all from backend.

## [2026-10-22 01:04] Codex

- **Task:** Reset disposable production Aiven defaultdb after explicit user confirmation to delete all tables/data and rebuild.
- **Summary:** Fixed fresh-replay blockers by combining UserPermission PK replacement and correcting final SubscriptionRefund operand casing. Verified exact host/port/database, TLS, dependencies and privileges; removed 29 FKs and 17 tables only from the authorized defaultdb, then successfully replayed all 36 migrations with strict TLS retained. No seeds or Studio launch.
- **Files changed:** backend/prisma/migrations/{20260908120316_fix_userpermission_pk,20261020132836_init_dev}/migration.sql, backend/prisma/migrations/FEATURE.md, backend/tests/prisma/migrations.test.ts; root/backend activity logs. Other existing wrapper/docs changes preserved; private env files unchanged.
- **Endpoints / rate limiting:** N/A; production database schema/data reset explicitly authorized; no frontend/API/permission-rule changes. Replayed feedback migration supplies its existing three permission definitions.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Initial regression run failed on PK gap and existing final casing error; all 72 migration tests, lint and diff checks pass after corrections. Docker daemon unavailable, so isolated replay was not run. Live deploy exited 0 and separate Prisma status exited 0 with schema up to date: 36 finished, zero failed, 32 tables, two audit triggers, PK(id) and two UserPermission FKs, zero users/organizations. Initial postcheck incorrectly expected zero permissions; read-only inspection confirmed three feedback permissions intentionally inserted by migration SQL. Historical SQL checksums changed: other already-initialized databases need separate reconciliation, not reset. Seed/bootstrap and application build/start not run; earlier schema/client alignment issue remains outside this reset.

## [2026-10-22 00:52] Codex

- **Task:** Diagnose persistent P3009 after manual UserPermission recovery guidance.
- **Summary:** Supplied deploy output proves an unresolved failed migration remains in selected defaultdb. Found earlier guidance used migrate resolve although wrapper blocked it; corrected production allowlist and required existing production confirmation for resolve. Documented table/history inspection, guarded manual completion and applied-history recovery in ENVIRONMENT.md.
- **Files changed:** backend/scripts/prisma.mjs, backend/tests/config/prisma-cli.mjs, backend/docs/ENVIRONMENT.md; root/backend activity logs.
- **Endpoints / rate limiting:** N/A; no frontend, schema, migration SQL, API, permission or database-record changes.
- **Status:** Local wrapper fix completed; live recovery unverified/user-operated. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Two resolve guard/cancellation regressions failed before fix; all 12 wrapper tests, lint and diff checks passed after. No private env reads, database connections, Studio startup, resolve, migrations or seeds run. User must verify primary key(id), columns and unique index on the same target before resolve --applied; original partial DDL means rolled-back/retry is not appropriate without reconciliation. Build omitted for wrapper/docs-only change. Prior CLI-success inference was incorrect; do not assume table/history state from conversational acknowledgments.

## [2026-10-22 00:41] Codex

- **Task:** Fix production Studio metadata loading failure with self-signed certificate in certificate chain.
- **Summary:** Traced installed Prisma Studio to mysql2: strict verification is mapped, but sslcert is ignored. Wrapper now resolves the selected CA with the shared database URL helper, checks readability and supplies NODE_EXTRA_CA_CERTS at Studio child startup. Updated certificate troubleshooting docs; parent environment and private env files unchanged.
- **Files changed:** backend/scripts/prisma.mjs, backend/tests/config/prisma-cli.mjs, backend/docs/ENVIRONMENT.md; root/backend activity logs. Existing Studio shortcut changes preserved.
- **Endpoints / rate limiting:** N/A; no frontend, schema, migration, API, permission or database-record changes.
- **Status:** Completed local fix; live Studio browsing unverified. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Two CA-forwarding/readability tests failed before implementation; all 12 wrapper tests, 44 config tests, lint and diff checks passed afterward. Local ephemeral TLS probe proved wrapper CA trust succeeds while untrusted certs and wrong hostnames fail. No Studio started, production contacted or private env files read. User must restart npm run studio:prod to load the CA at Node startup. Build omitted for wrapper/docs-only change.

## [2026-10-22 00:34] Codex

- **Task:** Stop Studio and provide a documented production Studio script instead of launching it.
- **Summary:** Stopped session 11016 and confirmed localhost:5555 no longer responds. Added studio:prod npm shortcut through the existing environment wrapper; production Studio now requires explicit production confirmation. Documented command, target selection, shutdown, dependency requirements and known custom-CA limitation.
- **Files changed:** backend/package.json, backend/scripts/prisma.mjs, backend/tests/config/prisma-cli.mjs, backend/docs/ENVIRONMENT.md; root/backend activity logs.
- **Endpoints / rate limiting:** N/A; no frontend, schema, migration, API, permission or database-record changes.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Two updated guard tests failed before implementation; all ten Prisma wrapper tests, lint and diff checks passed afterward. Studio not restarted; no hosted database queries or private env reads during this change. Actual Studio database/CA compatibility remains unverified; documented mysql2 sslcert warning. Build omitted for npm/wrapper/docs-only change. User will run npm run studio:prod manually.

## [2026-10-22 00:31] Codex

- **Task:** Start Prisma Studio against production.
- **Summary:** Verified installed CLI options and existing wrapper Studio block; started explicit one-off NODE_ENV=production Studio session on port 5555 as requested, leaving wrapper policy unchanged. Local HTTP returned 200.
- **Files changed:** Root/backend ACTIVITY.md only; no private env edits.
- **Endpoints / rate limiting:** Local Studio http://localhost:5555; no application API changes.
- **Status:** Studio running (exec session 11016). **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Studio reports mysql2 ignores sslcert URL option; UI startup does not prove database browsing or CA handling works. No record edits or migrations executed. Listener inspection denied by sandbox; HTTP check passed. Existing strict runtime/Prisma config unchanged. Production Studio allows user edits; no test/build needed for launcher-only task.

## [2026-10-22 00:17] Codex

- **Task:** Diagnose production migration 20260908120316_fix_userpermission_pk failing with MySQL 3750.
- **Summary:** Inspected migration and official MySQL primary-key policy; verified production metadata over TLS with read-only queries. sql_require_primary_key=1 rejects standalone DROP PRIMARY KEY. Columns and unique index from statements 1-2 already exist; old composite primary key remains; table has zero rows.
- **Files changed:** Root/backend ACTIVITY.md only.
- **Endpoints / rate limiting:** N/A; no schema, migration files, API, permission or database records changed.
- **Status:** Diagnosis completed; user requested read-only guidance. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Proposed one ALTER TABLE dropping old PK and adding PK(id), verify full migration postconditions, then resolve only this failed migration as applied. Do not blindly retry or mark rolled back: earlier DDL persists despite applied_steps_count=0. No remaining migrations deployed. Root AGENTS section 14 requires approval for production integrity changes; user chose commands only, so no production writes authorized or executed. No tests needed for activity-only edits.

## [2026-10-22 00:03] Codex

- **Task:** Test production database connectivity and diagnose connection failure.
- **Summary:** Read-only probes confirmed DNS/TCP, authenticated MySQL SELECT 1 and verified TLS. Isolated Prisma native CLI failure to relative CA-path resolution; shared config now forwards an absolute CA path while retaining strict verification. Added regression coverage and CA-path documentation.
- **Files changed:** backend/src/config/database.ts, backend/prisma.config.ts, backend/tests/config/environment.test.ts, backend/docs/ENVIRONMENT.md; root/backend activity logs. Private env files unchanged; existing package-lock edit preserved.
- **Endpoints / rate limiting:** N/A; no frontend, schema, migration SQL, API, permission or database-record changes.
- **Status:** Completed connection diagnosis/fix. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Live production Prisma migrate status now connects and reports 36 pending migrations (expected exit 1); none applied. All 66 focused Jest tests, ten Prisma CLI guard tests, lint and diff checks passed. Build still fails with 356 existing generated Prisma model casing/default diagnostics. Review migration state and schema/client alignment separately before deployment. Credentials used locally only for the authorized read-only checks and never printed; an initial probe-only unsupported timeout option was removed before successful verification.

## [2026-10-21 23:13] Codex

- **Task:** Restore mandatory production MySQL SSL/TLS.
- **Summary:** Restored production sslaccept=strict URL validation and verified runtime TLS. Replaced opt-out tests with rejection/adapter regression checks; restored mandatory TLS guidance and public example. Development/test local MySQL behavior and Redis TLS remain unchanged.
- **Files changed:** backend/src/config/database.ts, backend/tests/config/environment.test.ts, backend/.env.example (public template), backend/README.md, backend/docs/{ENVIRONMENT.md,DOCKER.md}; activity logs. No private env files read or edited.
- **Endpoints / rate limiting:** N/A; no frontend, schema, migration, API, permission or database-record changes.
- **Status:** Completed TLS restoration; existing schema/client build blocker remains. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Both new TLS restriction cases failed before restoration; all 64 targeted Jest tests, ten Prisma CLI guard tests, lint and diff checks passed afterward. Build still fails with 356 diagnostics from existing generated Prisma model casing/default mismatches (auditLog vs auditlog, etc.); schema/client left untouched. No database connections, migrations, seeds or production startup attempted. The selected production URL must include sslaccept=strict and the database endpoint must support TLS.

## [2026-10-21 19:55] Codex

- **Task:** Remove mandatory MySQL sslaccept=strict blockers and allow connection_limit-only production URLs.
- **Summary:** Removed mandatory production TLS validation and runtime forced TLS; both Prisma CLI and adapter now accept URLs with only connection_limit. Explicit sslaccept=strict/sslcert still enables verified runtime TLS. Updated public example and deployment docs; kept remote-host/socket checks, Redis TLS and production migration confirmations.
- **Files changed:** backend/src/config/database.ts, backend/tests/config/environment.test.ts, backend/.env.example (public template), backend/README.md, backend/docs/{ENVIRONMENT.md,DOCKER.md}; activity logs. No private env files read or edited.
- **Endpoints / rate limiting:** N/A; no frontend, database records, migration SQL, API or permission changes. Non-TLS production MySQL is now allowed as explicitly requested; its network traffic is unencrypted.
- **Status:** Completed TLS change; separate existing build failure remains. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Two regression cases failed before implementation; all 64 focused Jest checks and ten Prisma CLI guards then passed, along with lint/diff checks. Build failed on generated Prisma model casing/default mismatches (auditLog vs auditlog, User vs user, etc.). An in-memory compile with original HEAD database config reproduced 356 errors, proving independence from TLS edits; existing schema/client changes left untouched. No private env loading, database connections, migrations, seeds or production startup attempted. Manually remove sslaccept/sslcert from the selected DATABASE_URL for a non-TLS host. Resolve schema/client alignment separately before a successful app build.

## [2026-10-21 19:14] Codex

- **Task:** Explain Prisma migration failure reporting MySQL server lacks SSL capability.
- **Summary:** Traced the supplied log to the database TLS handshake, separate from successful code generation/build and npm warnings. Confirmed both production URL validation and runtime MariaDB adapter require TLS; checked official MySQL/Prisma encryption guidance. Recommended verifying a TLS-capable provider endpoint before changing connection policy.
- **Files changed:** Root/backend ACTIVITY.md only.
- **Endpoints / rate limiting:** N/A; no application, database, migration, API, permission or security-policy changes.
- **Status:** Completed diagnosis guidance. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** No .env files read, credentials accessed, hosted connections attempted, migrations run or tests executed. The supplied endpoint reports no SSL capability; provider-wide/plan-specific TLS support remains unverified. Removing sslaccept alone would not disable the runtime production SSL setting. Confirm provider TLS endpoint/CA availability or use an encrypted database connection path.

## [2026-10-21 19:08] Codex

- **Task:** Diagnose and fix run.sh failing to source .env.production.
- **Summary:** Used redacted structure checks and non-executing Bash validation to identify an extra trailing double quote on DATABASE_URL line 14. Removed exactly that redundant character while asserting the URL content was unchanged. The EOF error referred to the last line, not an invalid LOG_LEVEL value.
- **Files changed:** Private backend/.env.production quote delimiter only; root/backend ACTIVITY.md. No application or launcher code changed.
- **Endpoints / rate limiting:** N/A; no frontend, database, migration, API or permission changes.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Bash syntax failed with exit 2 before correction and passed with exit 0 afterward; dotenv parsing and MySQL URL/sslaccept format checks passed. No credentials printed, URL content changed, env file staged, database connection, install, migration or production launch attempted. Build/lint/unit tests omitted because only a private config delimiter changed. Retry npm run prod:all.

## [2026-10-21 18:57] Codex

- **Task:** Explain production MySQL URL validation for Freehostia.
- **Summary:** Traced database.ts production sslaccept=strict check and environment-variable precedence; checked official Prisma MySQL URL guidance. Prepared a placeholder DATABASE_URL and field/encoding explanation, distinguishing local validation from provider TLS/remote-access capability.
- **Files changed:** Root/backend ACTIVITY.md only.
- **Endpoints / rate limiting:** N/A; no application, frontend, schema, migration, API or permission changes.
- **Status:** Completed explanation. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** No credential files read, database connections attempted, tests run or configuration changed. Effective production URL must include sslaccept=strict; exported DATABASE_URL overrides the file. Freehostia account-specific host, remote access and verified TLS support remain unverified.

## [2026-10-21 18:46] Codex

- **Task:** Make backend production startup/build instructions easy to find.
- **Summary:** Confirmed the existing docs/ENVIRONMENT.md guide and added backend/README.md with production prerequisites, the prod:all launcher, separate generate/build/migration/prune/start steps, existing-build startup and links to configuration/seed guides. Added a backlink from the detailed guide.
- **Files changed:** backend/README.md, backend/docs/ENVIRONMENT.md, root/backend ACTIVITY.md.
- **Endpoints / rate limiting:** N/A; documentation only. No frontend, runtime, database, migration, API or permission changes.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Verified two docs, ten local links/anchors, documented npm mappings, launcher steps and diff whitespace. Application lint/build/tests and production commands were not run because this change only documents existing behavior. Configure private .env.production before running prod:all; existing-build start must explicitly select NODE_ENV=production.

## [2026-10-21 13:26] Codex

- **Task:** Diagnose and fix navigation 429s, request volume and deployment configuration across both apps.
- **Summary:** Recorded production-build sample and real Redis baselines before source edits; moved API budgets after auth, separated login/refresh/signup, preserved sensitive/public guards, centralized env defaults, added recoverable bounded Redis readiness and count endpoints, reduced polling and hardened cross-session refresh/logout. Final independent review findings were fixed and tested.
- **Files changed:** Complete one-line inventory in docs/RATE_LIMIT_FILE_INVENTORY.md; diagnosis, mount map, caveats and DO checklist in docs/RATE_LIMITING.md; deferred provider checklist in docs/UPSTASH_RATE_LIMIT_SETUP.md. Existing activity history preserved.
- **Endpoints / rate limiting:** API 300/min per persisted user; WRITE 30/min per user; DELETE 5/15min per user; AUTH 10 failed/15min IP; REFRESH 60/min verified bearer subject/IP; signup/reset/refund budgets preserved; public writes retain 30/hour IP. New GET /api/{service-requests,jobs,invoices}/counts use existing READ permissions and authenticated API middleware. Logout cookie clearing is idempotent before guard and in direct controller use.
- **Status:** Completed implementation and local verification; Upstash deferred by user. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Final backend build, full source/test TypeScript and ESLint passed; full Jest 1,035 passed/2 unrelated failures (existing migration-table casing and absent installed pino-roll). Targeted logout/controller cases 69 passed; readiness/store/policy 24 passed; real Docker Redis 7 normal/shared-instance plus 3 outage/recovery tests and Compose health/AOF persistence passed. Frontend final build/TypeScript, changed-file lint, 10 transport/retry tests and four existing browser suites passed; final 15 tenant/12 platform sample transitions measured 44→33 / 16→16 calls, 429 retry 2,031ms, hidden/fresh focus zero. No live database/production writes, secrets, migrations, permission or dependency-version changes. Real Upstash/proxy/login/latency and browser cookie-jar race checks remain deployment validation; owned test containers stopped, named volume retained.

## [2026-10-21 13:11] Codex/rate-limit-runtime

- **Task:** Diagnose shared limiter counters and verify Redis/runtime infrastructure.
- **Summary:** Captured unchanged-source Redis headers and proxy evidence before edits; centralized budget configuration, local Redis defaults, fail-fast warm-client reuse, local Compose Redis and Vercel stdout logging. Added real app/routing policy tests and two-process real Redis/outage fixtures.
- **Files changed:** src/config/{rate-limit.ts,env-schema.ts}, src/lib/{redis.ts,logger.ts}, .env.example, docker-compose.yml, docs/{UPSTASH,ENVIRONMENT,LOGGING}.md, tests/{cache/redis-client,config/environment,logging/logger}.test.ts, tests/rate-limit/* and sibling runtime verification artifacts.
- **Endpoints / rate limiting:** Verified existing auth/protected routes and 429 headers/body/CORS; budget defaults and namespaces centralized for root-agent limiter changes. No schema, migration, permission, real account or application-data changes.
- **Status:** Completed local verification. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Focused 6 suites/74 tests passed; one pre-existing rotation test excluded because declared pino-roll is absent from installed modules. Full source/test TypeScript and targeted ESLint passed. Real isolated Redis: 6 shared-process/identity/login tests plus 3 outage/recovery/decrement tests passed; Compose health/AOF persistence passed. Only owned test containers stopped; named volume retained. Upstash deferred by user; production Vercel storage/runtime acceptance remains external.

## [2026-10-21 12:59] Codex/sidebar-counts

- **Task:** Replace shell list-total requests with tenant-scoped aggregate counts.
- **Summary:** Added one cached status aggregate per request/job/invoice module, compatible response shapes, strict empty query schemas, existing read permissions and feature documentation. Added real-auth/cache isolation, zero-count, permission-revocation, invalidation and failure tests with isolated adapters.
- **Files changed:** src/modules/{service-request,job,invoice}/{schema,controller,routes,service,FEATURE.md}, tests/workflow/sidebar-counts.test.ts, ACTIVITY.md.
- **Endpoints / rate limiting:** GET /api/{service-requests,jobs,invoices}/counts; authenticated module mounts use the shared API limiter coordinated in routes/index.ts.
- **Status:** Completed count implementation and focused checks. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** 64 focused tests (33 new counts cases), targeted ESLint, full source/test TypeScript check and diff check passed. No schema/migration, dependency, database writes or production access; full-app and limiter verification coordinated by root agent.

## [2026-10-21 11:50] Codex

- **Task:** Audit backend contributions to delayed frontend navigation feedback.
- **Summary:** Read dashboard/platform operations, request logging and cache documentation. Confirmed existing Promise.all query groups, scoped 30-second dashboard caches and intentional authorization/snapshot/dependent-query ordering. No server implementation edits.
- **Files changed:** ACTIVITY.md only; sibling frontend implementation and complete inventory are documented in ../service-flow/docs/navigation-loading.md.
- **Endpoints / rate limiting:** N/A; no endpoints, API contracts, schema, migrations, permissions or limits changed.
- **Status:** Completed read-only audit. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** No backend tests or live tenant/production queries were run for this source-only audit. Existing responseTime logs/query plans are needed to measure real endpoint p50/p95 before optimizing transaction-bound aggregates. Frontend sample tests/build and appearance-waterfall fix are recorded in its activity log.

## [2026-10-21 05:29] Codex

- **Task:** Restrict production seed to system administrator and global permissions.
- **Summary:** Added seed:prod and atomic permissions/operator helpers; shared compiled bootstrap validation/provisioning while retaining standalone duplicate rejection. Idempotent production retries preserve existing active platform accounts/passwords; tenant/inactive collisions fail safely. Disabled production plan/catalog seeds and updated setup documentation.
- **Files changed:** package.json, scripts/prisma.mjs, prisma/{seed-production.ts,seed-catalog.ts,seeds/production.ts,seeds/permission-catalog.ts,seeds/catalog.ts,seeds/FEATURE.md}, src/modules/system-admin/{bootstrap.ts,bootstrap.cli.ts,FEATURE.md}, docs/{ENVIRONMENT.md,SYSTEM_ADMIN.md}, tests/prisma/{production.test.ts,development.mysql.mjs}, tests/config/prisma-cli.mjs, activity logs.
- **Endpoints / rate limiting:** N/A; no frontend, schema, migration, API or tenant permission-grant changes. Only operator/global permissions plus required role/audits are provisioned by production apply.
- **Status:** Completed implementation and local checks; no production execution. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** 43 focused seed tests, ten wrapper guard tests, lint/build, full TypeScript source/test check and real local MySQL rollback checks passed. Verified minimal-production writes only to Permission/User/Role/AuditLog, bcrypt login material and credential-preserving reruns; full development batch still passes. Both batches rolled back and every model digest matched its original value. No production connection or committed data changes; configure SYSTEM_ADMIN_* privately and use seed:prod -- --dry-run / --apply. Existing unrelated migration casing test was not repeated or modified.

## [2026-10-21 05:24] Codex

- **Task:** Add full development seed and verify it safely.
- **Summary:** Added seed:dev using the environment wrapper, local/production guards, DEV_SEED_PASSWORD validation/hashing, shared atomic catalog/electrical helpers, tenant/operator accounts, defaults and overrides, settings/pages, independent workflows and platform billing/signup examples. Existing edits/grants preserved; collisions and seat overflow roll back; batch marker makes reruns additive and repeatable.
- **Files changed:** package.json, .env.example, scripts/prisma.mjs, docs/ENVIRONMENT.md, prisma/{seed-development.ts,DEVELOPMENT_SEED.md,seeds/development*.ts,seeds/catalog.ts,seeds/bright-star.ts,seeds/FEATURE.md}, tests/prisma/development*, tests/config/prisma-cli.mjs, activity logs.
- **Endpoints / rate limiting:** N/A; backend seed tooling only, no frontend/schema/migration/API changes or existing permission-grant resets.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** 33 seed tests, ten environment/wrapper guards, lint/build, full TypeScript source/test check, local dry run and diff checks passed. Broader Prisma suite 73/74: pre-existing init_dev subscriptionrefund casing test fails; left unchanged. Real MySQL rollback-only check passed full batch, permissions/passwords, tenant ownership, invoice/payment consistency, history/billing/seat checks and repeatability; all table digests unchanged afterward. No fixtures committed; set DEV_SEED_PASSWORD privately then run seed:dev -- --apply. Redis invalidation after actual commit and frontend browsing were not exercised.

## [2026-10-20 21:41] Codex

- **Task:** Add staff scheduling and active-work warnings with explicit overrides.
- **Summary:** Added live availability checks within existing serializable job-write transactions, half-open/open-ended schedule handling, busy-job checks and transactional override audit metadata. Preserved omitted update text fields and excluded completed/cancelled/self jobs. Added API/permission/tenant/failure tests and an opt-in MySQL concurrency case.
- **Files changed:** src/modules/job/{staff-conflicts.ts,job.schema.ts,job.controller.ts,job.service.ts,FEATURE.md}, tests/workflow/{staff-conflicts.test.ts,mysql.integration.mjs}, ACTIVITY.md.
- **Endpoints / rate limiting:** POST /api/jobs, PUT /api/jobs/:id, PATCH /api/jobs/:id/status; existing apiLimiter/writeLimmiter and permissions retained. Added optional boolean overrideStaffConflict and 409 JOB_STAFF_CONFLICT; no schema, migration, dependency or permission changes.
- **Status:** Completed implementation and available checks. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** 121 focused tests, build, lint, integration-script syntax and diff checks passed. Broader run: 926/928 passed; logging timeout passed on isolated rerun. Unrelated untracked init_dev migration still fails subscriptionrefund table-casing validation; untouched. MySQL concurrency/integration case not run because it requires a configured test database; no database operations performed.

## [2026-10-20 21:14] Codex

- **Task:** Make database selection explicit for migrations, seeds and other Prisma commands.
- **Summary:** Added prisma:dev/prisma:prod wrapper with credential-free target display and required mode for existing migration/generation/seed shortcuts. Dev file replaces inherited DB/cache settings; production injected variables retain priority. Production blocks reset/dev migration/db push/execute/studio/tenant samples and confirms deploy/catalog apply; preserves the production-only catalog distinction. Integrated explicit selection into the backend launcher and updated affected instructions.
- **Files changed:** backend/scripts/prisma.mjs, backend/scripts/run.sh, backend/package.json, backend/.gitignore, backend/tests/config/{prisma-cli.mjs,launcher.mjs}, backend/docs/{ENVIRONMENT.md,SYSTEM_ADMIN.md}, backend/prisma/{seed-catalog.ts,seed-bright-star.ts,BRIGHT_STAR_DEMO.md,seeds/FEATURE.md}; activity logs.
- **Endpoints / rate limiting:** N/A; no frontend, API, permission, Prisma schema or migration SQL changes. Existing env values preserved.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Ten CLI guard/precedence/prompt tests, six mocked launcher checks, 60 targeted Jest checks, build, lint, wrapper/Bash syntax, diff checks and real wrapper schema validation passed. Validation proved dev ignores an inherited remote URL without querying it. No real migrations, resets, seeds, Docker starts or production writes performed. Full unrelated test suite not repeated. Manual DB operations should use wrappers; direct npx still inherits its shell. Source tools need dev dependencies. run.sh staged update retains 100755.

## [2026-10-20 21:02] Codex

- **Task:** Explain how to target the development database for Prisma migrate reset.
- **Summary:** Inspected Prisma config, mode-file precedence and package scripts; checked official Prisma 7 reset documentation. Provided Bash instructions to explicitly source .env.development, select development mode, inspect migrate status and then run the interactive reset.
- **Files changed:** Root/backend activity logs only.
- **Endpoints / rate limiting:** N/A; no application, schema, migration, API or permission changes.
- **Status:** Completed guidance. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** No database contacted, reset executed or tests run. Reset destroys all data in the selected database and reapplies migrations; verify datasource host/name first. Existing process DATABASE_URL overrides dotenv defaults, so explicit sourcing is required to replace an inherited target. Prisma 7 seeding is separate.

## [2026-10-20 18:58] Codex

- **Task:** Simplify development startup to Docker Redis only with existing local MySQL.
- **Summary:** Replaced Compose with direct Redis container create/start/readiness checks and persistent volume. Removed newly added development Compose and MySQL bootstrap logic; removed root/3307 constraints. Backend remains a local Node process; production behavior and existing env values preserved.
- **Files changed:** backend/scripts/run.sh, backend/tests/config/launcher.mjs, backend/.env.example, backend/docs/ENVIRONMENT.md; removed backend/docker-compose.dev.yml; activity logs.
- **Endpoints / rate limiting:** N/A; no frontend, schema, API, permission or rate-limit changes.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Six isolated mocked launcher tests, lint, Bash syntax and diff checks passed. No real container or database operations performed; application build/unit suites not repeated for shell/docs-only changes. Start the existing local MySQL service and keep its actual DATABASE_URL credentials/port. Redis uses serviceflow-dev-redis and serviceflow-dev-redis-data; Compose is not required. Updated staged run.sh while retaining executable mode 100755.

## [2026-10-20 18:40] Codex

- **Task:** Configure backend development/production environments and a single MySQL/Redis launcher.
- **Summary:** Added mode-file loading, typed Zod startup validation, single DATABASE_URL adapter/CLI/seed configuration, verified production TLS and remote-host checks, Docker-only local dev services, production migration confirmation, and runtime dependency pruning. Retained the existing shared Redis client and Prisma singleton; preserved existing env values.
- **Files changed:** backend config/Prisma/auth/CLI files, package scripts, scripts/run.sh and delegating wrappers, development Compose, .env.example/private production template, ignore/line-ending rules, configuration tests and environment/feature docs; activity logs.
- **Endpoints / rate limiting:** N/A; no frontend, API contract, permission, schema or migration SQL changes. Refresh-cookie security now uses typed NODE_ENV.
- **Status:** Completed implementation and available checks. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** All 896 Jest tests, five mocked launcher checks, four predeploy safety checks, build/lint, Prisma generation/validation, Compose config, Bash syntax and diff checks passed. Initial sandbox logging timeout passed on full rerun outside sandbox. No real migrations, seeds, Docker service starts or production prune/start performed. Existing dev DATABASE_URL needs local root@127.0.0.1:3307; production blanks/provider remote TLS/DDL privileges need operator setup. Legacy VPS/socket and production-local predeploy flows conflict with the requested production rules (documented). run.sh alone staged to record mode 100755 on Windows.

## [2026-10-20 18:12] Codex

- **Task:** Correct all remaining migration casing failures and prevent repeat Linux deployment errors.
- **Summary:** Fixed exact table casing in 16 remaining SQL migrations, including UPDATE and index operations; preserved the earlier Job fix. Added 35 migration regression checks, case-sensitive standalone predeploy replay and recovery/compatibility docs.
- **Files changed:** prisma/migrations/*/migration.sql, prisma/migrations/FEATURE.md, tests/prisma/migrations.test.ts, scripts/{predeploy.mjs,PREDEPLOY.md}, docs/DOCKER.md, activity logs; sibling artifacts/migration-casing-20261020.
- **Endpoints / rate limiting:** N/A; no frontend, API contracts, permissions, Prisma models or application business rules changed. SQL differences across all 17 edited files are casing/whitespace only.
- **Status:** Completed code and isolated verification. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Fresh Linux MySQL 8.4.11 casing=0 and casing=1 each passed all 35 migrations, zero unresolved failures, two audit triggers, migration status and repeat deploy. All 35 Jest checks, four predeploy safety tests, backend lint, Prisma validate, runner syntax and diff checks passed. Safety tests initially hit sandbox EPERM; reran without Node test process isolation. Docker needed approved execution. Test containers stopped, data retained; no configured/hosted database touched. App builds/full predeploy/unrelated suites not run. Deploy corrected files then inspect failed migration logs before conditional rollback marking/redeploy; populated upgrades and successful-history checksum reconciliation remain environment-specific.

## [2026-10-20 18:00] Codex

- **Task:** Explain P3009 after the migration casing correction and identify safe recovery.
- **Summary:** Verified Prisma guidance distinguishes failed migration history from edited successfully applied migrations. Prepared read-only migration-log query and conditional resolve --rolled-back/redeploy instructions only when failure occurred before any successful statement.
- **Files changed:** Root/backend activity logs only; no additional migration, frontend, API, permission or rate-limit edits.
- **Status:** Completed diagnosis guidance; deployed failure logs/state remain unverified. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** No database accessed, history updated, migration applied or tests run. Inspect target _prisma_migrations.logs and partial DDL before recovery; rollback marking does not undo SQL. Sixteen later migrations still have casing mismatches. Official Prisma error/recovery documentation checked.

## [2026-10-20 17:54] Codex

- **Task:** Fix Linux MySQL table casing in migration 20260814121245_update_some_models_adding_new.
- **Summary:** Corrected nine ALTER TABLE targets and five warning references to the existing Job, Customer, ServiceRequest, ServiceType and User casing. Preserved all columns, indexes, constraints and business behavior.
- **Files changed:** prisma/migrations/20260814121245_update_some_models_adding_new/migration.sql, root/backend activity logs.
- **Endpoints / rate limiting:** N/A; no frontend, API, permission, Prisma model or tenant-boundary changes. No database contacted or migration applied.
- **Status:** Completed requested file correction. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Static verification passed for all 49 table references and casing-only diff; Prisma validate and git diff --check passed. Initial Node subprocess check hit sandbox EPERM; rerun using PowerShell-provided baseline passed. Linux SQL replay unavailable because Docker engine is stopped; application lint/build/tests were not run for SQL-only edits. Sixteen other migrations retain casing mismatches, beginning with 20260818111948_add_user_deleted_at. Existing successful migration histories need checksum reconciliation planning; failed runs require partial-DDL inspection before recovery/retry.

## [2026-10-20 06:14] Codex

- **Task:** Implement production-safe global catalog provisioning and seed the hosted database.
- **Summary:** Added seed:catalog with default dry run and explicit --apply; global permission collision checks; one transaction for permissions, existing plan catalog and operator audits; preserved existing rows/grants; invalidated plan projections after apply. Documented tenant catalogs/configuration exclusions and source/Docker prerequisites.
- **Files changed:** package.json, prisma/{seed-catalog.ts,seeds/catalog.ts,seeds/plans.ts,seeds/FEATURE.md}, tests/prisma/catalog.test.ts, ACTIVITY.md and parent activity log.
- **Endpoints / rate limiting:** N/A; no schema, migration, API, permission-grant, tenant or frontend changes.
- **Status:** Partial: code complete, hosted seed blocked. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Seven unit tests, full lint/build and diff checks passed; locked dependencies restored with npm ci --include=dev --ignore-scripts. Dry run could not authenticate; read-only TCP probe succeeded and MySQL probe returned ER_ACCESS_DENIED_ERROR (1045 / 28000). No hosted writes attempted. Correct configured DATABASE_* authentication/remote-host grants before rerunning dry run and --apply; real MySQL rollback and cache invalidation on apply remain unverified.

## [2026-10-19 20:45] Codex

- **Task:** Fix production dependency cleanup failing with Windows esbuild EPERM.
- **Summary:** Confirmed local running esbuild PID 10816; added a dependency-free Windows process check before npm ci, clear Ctrl+C recovery instructions, script-relative working directory and gitignore allowlist. Restored dependencies after the lock and concurrent installer exited.
- **Files changed:** scripts/prod.sh, scripts/check-dependency-locks.mjs, .gitignore, ACTIVITY.md; parent activity log.
- **Endpoints / rate limiting:** N/A; no frontend, database, migration, API, permission, rate-limit or package/lockfile changes.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Bash/Node syntax, ten simulated guard cases, actual temporary esbuild lock/release checks, full lint, Prisma generation, production build and diff checks passed. Initial restore hit ENOTEMPTY while another npm ci ran; subsequent restore succeeded. Full production launcher/prune not executed. Guard covers the observed local esbuild executable lock; other Windows locks remain possible.

## [2026-10-19 20:00] Codex

- **Task:** Match the default application color to the teal Handoff logo.
- **Summary:** Set the frontend/backend default to #0d887d, aligned contrast-adjusted global light/dark palettes and sidebar/accent/focus states, preserved white text on fixed navy account panels, corrected dark canvas links, and updated website fallbacks and sample previews. New partial branding writes use teal and cache keys include the default. Saved tenant colors remain unchanged; Restore default theme stages teal for Save branding.
- **Files changed:** prisma/schema.prisma, prisma/migrations/20261019120000_handoff_default_color/migration.sql, organization/{branding.service.ts,page.service.ts,FEATURE.md}, tests/organization/{branding.test.ts,page.test.ts,mysql.integration.mjs}, activity logs.
- **Endpoints / rate limiting:** Existing settings/public website response shapes, tenant/admin checks and rate limiters unchanged; only default color behavior changes. No permission grants or dependencies added.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Frontend/backend lint and production builds including TypeScript passed; Prisma regenerated. Six organization/cache suites passed (115 tests), followed by 19 focused branding tests confirming saved red preservation. Both contrast tests, public desktop/mobile light/dark palette checks, Settings tenant/reset/logo/favicon browser regression and landing preview checks passed. All ten screenshots refreshed and inspected. Default-only migration applied and verified in isolated service_flow_platform_test_handoff_20261019, including direct database default, concurrency, FK/audit rollback and authorization; fixtures retained. Apply migration to the application database during deployment; no existing saved colors were rewritten. Initial browser CSS-format assertion and Windows temp-file cleanup issue were resolved by script normalization and clean rechecks. Pre-existing removal of archived system-logo files was left untouched.

## [2026-10-19 19:24] Codex

- **Task:** Apply the selected Handoff logo across the application and account email templates, with light/dark visibility.
- **Summary:** Integrated theme-aware outlined SVG lockups and symbols, fixed tones for navy panels and independent Settings previews, legal navigation, website attribution, browser/Apple icons, static opaque email PNG and matching teal email accents. Refreshed all ten sample product screenshots and documented asset use. Tenant-uploaded logos/favicons and tenant colors retain precedence.
- **Files changed:** src/lib/email/templates/layout.ts, src/lib/email/FEATURE.md, tests/email/templates.test.ts, activity logs; matching public frontend assets and verification artifacts.
- **Endpoints / rate limiting:** N/A; no API contracts, database, migrations, permissions, rate limits, dependencies or mail-delivery behavior changed.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Backend 18 email safety tests, full lint/build, frontend affected-code lint and production build with TypeScript passed. Light/dark desktop/mobile public branding/icon checks and Settings tenant/logo/favicon regression passed. All ten sample previews captured; the initial landing-image timeout passed on rerun. Fixed a transient navigation race in the artifact verification script. SVG/XML, PNG/ICO and syntax/diff checks passed; screenshots visually inspected. Browser checks required approved process-spawn escalation. No emails sent; real Gmail/Outlook rendering and live deployment remain unverified. Deploy frontend assets with the backend email change.

## [2026-10-19 19:06] Codex

- **Task:** Add the selected system logo to account email templates.
- **Summary:** Shared invitation/reset header now renders the supplied blue/teal mark with visible ServiceFlow text using inline tables. The 96px optimized raster URL reuses only the trusted action origin and has no invitation/reset parameters. Updated email feature documentation and existing safety tests.
- **Files changed:** `src/lib/email/templates/layout.ts`, `src/lib/email/FEATURE.md`, `tests/email/templates.test.ts`, root/backend activity logs.
- **Endpoints / rate limiting:** N/A; no API, database, permission, migration, dependency or email-delivery changes.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** All 18 template tests, full ESLint, backend build and diff checks passed. No emails sent or inbox compatibility checks performed. Public frontend origin/image optimizer must be reachable for remote images; live brand text remains when blocked. Reset sender stays an unimplemented placeholder.

## [2026-10-18 23:50] Codex

- **Task:** Run predeployment checks and fix only DigitalOcean VPS blockers.
- **Summary:** Added a self-contained VPS test mode and sibling Compose/Caddy deployment. Fixed standalone startup, production URL handling and trusted proxy configuration; patched runtime dependencies. Separated local-socket administrative migrations from CRUD-only API grants and verified native cold-start authentication.
- **Files changed:** `package.json`, `package-lock.json`, `src/app.ts`, `src/config/env.ts`, `scripts/predeploy.mjs`, `scripts/PREDEPLOY.md`, `docs/DOCKER.md`, `ACTIVITY.md`; sibling `deploy/` and verification artifacts.
- **Endpoints / rate limiting:** No routes, API contracts, application permission grants, schemas or migration SQL changed. Existing Redis thresholds are preserved; one private proxy is trusted only in Compose and forwarded headers are replaced.
- **Status:** Completed local verification. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Final VPS runner: 18 PASS/0 FAIL/1 pending external acceptance; JSON exitCode 2. Backend 35 suites/805 tests, frontend 29 tests, runner 4 tests, both lint/type/build/start checks and 14 Compose checks passed, including 34 fresh migrations, real HTTPS sessions, Redis spoof/rate-limit tests, persistence and separate logical restore. API runtime audit: zero findings; frontend CLI-only advisories remain outside the standalone image. Existing DB/env files untouched; all owned test containers stopped, volumes retained. Public DNS/ACME, real mail, browser workflows, offsite backups and actual VPS capacity remain; see `../artifacts/predeploy-20261018-vps/REPORT.md`. Default native mode remains available; VPS mode no longer depends on native MySQL/Redis.

## [2026-10-18 16:01] Codex

- **Task:** Review the user's new .env.docker and clarify prior Docker testing.
- **Summary:** Confirmed image tests passed previously but did not exercise this new file or a full MySQL/Compose stack. Secret-safe inspection found only DATABASE_URL; actual API-image environment validation with networking disabled failed on nine missing runtime fields. Added .env variants to Git ignore and documented build/runtime configuration and the safe validation command.
- **Files changed:** `.gitignore`, `docs/DOCKER.md`, `ACTIVITY.md`. `.env.docker` contents and Dockerfile unchanged.
- **Endpoints / rate limiting:** N/A; no app startup, API requests, database operations, email sends or permission changes.
- **Status:** Completed diagnosis. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Git ignore verification and diff checks passed. MySQL named mysql is Created (not running), attached to appnet, with host port 3306 configured; startup error is empty, so no cause was inferred. Full Compose file is still empty. No container was started/reconfigured except the automatically removed network-disabled environment validator. Complete runtime settings and shared service orchestration before connection tests; secrets were not printed or copied.

## [2026-10-18 14:41] Codex

- **Task:** Implement frontend/backend Dockerfiles and Docker ignore files.
- **Summary:** Filled the empty backend files with a Node 24 Linux build, non-root production runtime and separate migration target. Kept secrets/host outputs out of context, preserved SQL migrations, and documented environment injection and volume requirements. Added/tested the corresponding frontend packaging and private server API URL.
- **Files changed:** `Dockerfile`, `.dockerignore`, `docs/DOCKER.md`, `ACTIVITY.md`; frontend Docker/config/website docs/loader and sample-only `../artifacts/docker-20261018/` verification artifacts.
- **Endpoints / rate limiting:** N/A; no routes, API contracts, schemas, migration contents, permissions or limiter settings changed. Only isolated test Redis counters were exercised.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** All three Linux images built; migration schema validation passed with networking disabled and 34 SQL migrations retained. Runtime HTTP, non-root/secret/toolchain exclusion, storage/logs/static assets/private API SSR/share-image/404 checks passed; 5 frontend metadata tests and affected lint/diff checks passed. No existing DB or env changed and no email sent. Sample containers stopped/retained. Final API dependency install still reports 5 findings including 1 critical; frontend lockfile audit flags Next.js critical. Versions were not updated; see artifact REPORT.md before public launch. Full Compose/DB/HTTPS/restore/load tests remain next.

## [2026-10-18 14:12] Codex

- **Task:** Identify the next deployment step after local checks.
- **Summary:** Found the latest report still contained only backend checks; corrected premature PASS headings so unfinished runs show RUNNING, JSON completed=false and exitCode=null. Identified Docker packaging and local proxy/container verification as the next step.
- **Files changed:** `scripts/predeploy.mjs`, `scripts/predeploy-utils.mjs`, `scripts/predeploy-safety.mjs`, `scripts/PREDEPLOY.md`, `ACTIVITY.md`.
- **Endpoints / rate limiting:** N/A; no application, API, database, migration, permission or rate-limit changes.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Four runner safety tests, affected-script ESLint and diff checks passed. Did not restart or rerun the full suite; already-running processes retain the previous heading logic. Dockerfiles/dockerignore remain absent, Compose is empty and Next standalone output is not configured. Create/test these locally before provisioning paid hosting.

## [2026-10-18 14:06] Codex

- **Task:** Review API request logging and prevent unbounded log-file growth.
- **Summary:** Confirmed existing Pino HTTP logging; added validated LOG_MAX_FILES retention through the installed pino-roll transport, safe request/response metadata serializers and logging before CORS. Added request IDs on early responses, operational documentation and regression coverage. Existing log files and database audit records were not deleted.
- **Files changed:** backend/src/lib/logger.ts, backend/src/middleware/request-logger.ts, backend/src/app.ts, backend/src/config/env.ts, backend/docs/LOGGING.md, backend/tests/logging/{logger,request-logger}.test.ts; root/backend ACTIVITY.md.
- **Endpoints / rate limiting:** No routes, API bodies, database, migrations, permission grants, rate limits or dependencies changed. X-Request-Id is now also returned on CORS preflights and other early responses; existing limiters remain in place.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Full backend Jest passed (35 suites/805 tests), including 14 new logging tests and real temporary-directory rotation/cleanup; full ESLint, TypeScript including tests and production build passed. Retention defaults to 14 files plus active (budget up to 15/~150 MiB), prunes at rotation and includes prior runs; no scheduler needed. Keep LOG_LEVEL=info for all request summaries; stdout-host retention is separate. No live deployment, database integration or frontend checks were required. Initial PowerShell npm shim restriction was resolved using npm.cmd; test/type/lint issues were corrected before final checks.

## [2026-10-18 13:48] Codex

- **Task:** Add one command for local predeployment checks.
- **Summary:** Added `npm run test:predeploy` with sanitized per-command logs, Markdown/JSON reports, local-service safety guards, compiled runtime probes and fresh isolated Linux migration replay. Added runner safety tests and usage documentation; reports are ignored by Git.
- **Files changed:** `package.json`, `.gitignore`, `scripts/predeploy*.mjs`, `scripts/PREDEPLOY.md`, `ACTIVITY.md`.
- **Endpoints / rate limiting:** N/A; no application, API, schema, migration, permission or rate-limit changes. GET health/auth smoke probes exercise existing local rate-limit counters.
- **Status:** Completed. **Agent rate limit:** None hit. **Resets at:** unknown.
- **Next steps / Notes:** Final complete run: 24 PASS, 2 FAIL, 2 BLOCKED (exit 1). Backend 33 suites/791 tests, frontend 29 tests, runner 3 safety tests, both lint/type/build/start checks, MySQL/Redis, configured migration status and fresh Linux replay passed. Production configuration fails for CORS_ORIGIN, NEXT_PUBLIC_API_URL and SITE_URL. App Docker/proxy and external/browser/restore/load acceptance remain blocked. Corrected initial Jest discovery conflict by naming Node safety tests outside Jest's test patterns. Two uniquely named test containers were stopped with data retained; configured DB was read-only. Reports: `.predeploy/2026-10-18T05-45-47-743Z-5dc7a1/`.
