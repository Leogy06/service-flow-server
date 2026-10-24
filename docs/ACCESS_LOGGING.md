# Access logging setup

The admin screen is `/system-admin/access-logs`, under the existing platform-admin
shell. Tenant administrators cannot see global visitor information. It supports an
exact IP filter, pagination (up to 200 rows), and Top IPs (24h). API payload fields
are camelCase, wrapped in the existing `{ data: ... }` response envelope.

## Configuration

Use Node 20.19+ (or a newer supported Node runtime). Add these **backend** values in
Vercel project settings, and to the ignored backend `.env` locally:

```dotenv
DB_HOST=your-aiven-host
DB_PORT=your-aiven-assigned-port
DB_USER=your-database-user
DB_PASSWORD=your-database-password
DB_NAME=your-database-name
DB_CA="-----BEGIN CERTIFICATE-----
paste the full Aiven project CA certificate here
-----END CERTIFICATE-----"
CRON_SECRET=generate-a-long-random-secret
INTERNAL_API_SECRET=generate-a-different-long-random-secret
```

`DB_CA` must contain the full PEM with actual newlines, not a file path. Vercel's
value editor accepts multiline values. Set all six DB connection values together;
the existing singleton `PrismaMariaDb` uses them with verified TLS, a 10-second
connection timeout and `connectionLimit: 1`. Existing local DATABASE_URL-only
configuration remains supported, with the same one-connection runtime pool.

Add the **same** `INTERNAL_API_SECRET` to the frontend Vercel project and its ignored
`.env`/`.env.development`. Do not use a `NEXT_PUBLIC_` prefix. Next's existing public
business-page/metadata/share-image server reads forward the original IP via
`x-client-ip` plus `x-internal-api-secret`, using `await headers()`; geo and browser
metadata are forwarded too. Also set frontend-only `TRUSTED_VISITOR_IP_HEADER`
to `x-vercel-forwarded-for` or `x-forwarded-for` **only after verifying the edge
overwrites that header** and the origin cannot be reached around it. A shared
secret authenticates the Next server, not the visitor-supplied IP. With this
setting absent, forwarding is disabled and the API records its trusted peer.
Do not infer trust from a header's name or enable it on a directly exposed Next
server. With no shared secret configured the pages keep working,
but the API sees the Next server's IP. Existing browser Axios bearer/refresh auth
does not change. Neither secret is an alternative admin login.

Keep all existing JWT, CORS, Redis, email and other application settings. Injected
environment variables take precedence, followed by `.env`, then the existing
`.env.development`/`.env.production` file. All `.env*` are gitignored except the
backend's secret-free `.env.example`. No credentials have been added to Git.

## Schema installation

`DATABASE_URL` is needed **locally for Prisma CLI schema operations**, not by the
deployed runtime when DB_* are configured. Save the Aiven CA to an ignored local PEM
file and URL-encode special characters in the URL's username/password:

```dotenv
DATABASE_URL="mysql://USER:URL_ENCODED_PASSWORD@AIVEN_HOST:ASSIGNED_PORT/DATABASE?sslaccept=strict&sslcert=../certs/aiven-ca.pem"
```

The example CA path is relative to `prisma/`. Both the existing CLI config and URL
fallback runtime resolve certificate paths there. Inspect the full schema diff
against the intended target first; then, from `backend`, use the guarded wrapper:

```powershell
npm.cmd run prisma:prod -- migrate status
npm.cmd run prisma:prod -- migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# Review the exact target, existing DDL/history and forward SQL before deployment.
npm.cmd run prisma:prod -- migrate deploy
npm.cmd run prisma:prod -- generate
```

Do not use `db push`, `migrate dev`, reset, or `--accept-data-loss` in production.
Resolve migration-history drift separately; do not overwrite applied SQL. `postinstall` generates the
client for Vercel; it does not push the schema. Generation needs no DB connection;
Vercel builds can use the six DB_* values without DATABASE_URL. There is no new
Prisma client and the existing ESM `prisma-client` generator/output remain in use.

The backend `vercel.json` schedules `GET /api/cron/access-logs` daily at 00:00 UTC
(08:00 Asia/Manila). Vercel supplies `Authorization: Bearer CRON_SECRET`; requests
without the configured secret are denied. The deletion removes rows older than
30 days and is idempotent. Rows can remain until the next daily cleanup. Cron
schedules run on production deployments; verify execution after deployment.

## Verification and rollout

Run backend `npm.cmd run prod:build`, `npm.cmd run lint`, and
`npm.cmd test -- --runInBand tests/logging/access-logs.test.ts tests/config/environment.test.ts`.
Run frontend `npm.cmd run build`, `npm.cmd exec tsc -- --noEmit`, and
`npm.cmd run test:access-logs:browser`.

After reviewed migrations on an isolated local target, `npm.cmd run test:access-logs:mysql` starts the actual Express app on
a free localhost port, runs curl, queries real MySQL, and checks both protected
endpoints, the system-admin alias, anonymous/tenant denial, local IP fallback,
secret-gated internal forwarding and retention. It requires a loopback database
and an existing active local platform administrator, uses the project's token
signer only in memory, and retains recent synthetic traffic rows. It never creates
accounts or changes credentials. The cron test removes a synthetic 31-day-old row.

For a manual local request (use your API's configured port):

```powershell
curl.exe http://localhost:4000/api/access-log-check -H "x-vercel-forwarded-for: 203.0.113.42" -H "x-vercel-ip-country: PH" -H "x-vercel-ip-city: General%20Santos"
```

The intentional 404 is logged. With `TRUST_PROXY_HOPS=0`, the recorded IP remains
the actual socket peer even if forwarding headers are supplied. Express's
configured trust boundary controls `req.ip`; do not use `trust proxy=true` on a
public origin. Verify the actual proxy path and header replacement before setting
a hop count. Only the shared-secret internal `x-client-ip` override bypasses that
resolution. Geo headers are unverified enrichment, never authorization evidence.
Do not test with `/api/health`: it is excluded.
Logging covers requests reaching Express (including errors/preflights); static
Next pages/assets that never call Express are outside its scope.

Deploy a preview of both apps with the settings above. Verify real Vercel IP/geo
headers, Aiven TLS/connectivity, the shared-secret server fetch, and browser auth.
Deploy production and confirm the daily cron in Vercel. Local checks do not prove
provider headers, production connectivity or cron delivery.

The root-layout client notice remembers dismissal in localStorage, tolerates
blocked storage, and hides on `/admin` and `/system-admin`. The existing `/privacy`
keeps its content and adds automatic visitor-data collection/retention text;
the historical `/privacy/2026-10-17` document stays unchanged. **Replace the literal
`[CONTACT EMAIL]` placeholder in `features/legal/components/legal-document.tsx` in
the frontend before publishing the notice.** Existing legal contact settings are
separate and have not been replaced. This operational admin screen does not add
a customer-facing landing-page product preview.
