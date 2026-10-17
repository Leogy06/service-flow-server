# Organization settings and branding

Organization routes cover platform provisioning, tenant subscriptions and tenant
branding. Existing organization names/slugs and billing workflows retain their
contracts; branding display names never rename an organization or change URLs.

`branding.routes.ts`, schema, controller and service implement authenticated
`GET/PATCH /api/organization/settings`, `POST/DELETE /settings/logo` and
`POST/DELETE /settings/favicon`. Reads are available to every active tenant user;
writes require the trusted existing Admin/Tenant Admin role. Platform sessions
cannot use tenant settings. Tenant identity always comes from authentication
context, and strict schemas reject client organization selectors and asset URLs.
No new permission grants are introduced. Settings changes and tenant audits
commit together using the existing serializable tenant transaction helper.

Settings are an optional one-to-one `OrganizationSettings` relation. Missing rows
return red `#b91c1c`, null display name/assets/timestamps without a GET write.
PATCH accepts a six-digit hex `primaryColor` and nullable `displayName` (1–100
characters); null restores the color/name default. Responses use the standard
data envelope and include organizationId, primaryColor, displayName, logoUrl,
faviconUrl, createdAt and updatedAt. Null assets use Service Flow defaults.

Uploads send the file as the raw request body with its image Content-Type.
Logos accept PNG, JPEG and WebP; favicons accept PNG. Files must be at most
256 KiB and 2048 pixels on either side. Signature/structure/dimensions are checked;
SVG, animated PNG/WebP, user filenames and client-selected URLs are not accepted.
Opaque random URLs expose only current public branding raster assets, with fixed
image MIME, nosniff, sandbox CSP and immutable caching. Branding images are public;
do not upload private information. Replacements/reset remove unreferenced files
only after the database commits. Failed uploads clean up their unused file.

`BRANDING_UPLOAD_DIR` defaults to `storage/branding` relative to backend process
working directory; keep that directory private from generic static serving. In
production configure an absolute persistent shared volume mounted by every API
instance. Back up it together with the database; ephemeral disk loses images.
Failed filesystem cleanup is logged and may require routine orphan maintenance.
Deploy the additive settings migration and regenerate Prisma before use.

All endpoints inherit the global API limiter; writes additionally use the shared
write limiter. Uploads use Redis user limits configured with
`BRANDING_UPLOAD_RATE_LIMIT_WINDOW_MS` (60000) and
`BRANDING_UPLOAD_RATE_LIMIT_MAX` (10). Public assets use Redis IP limits configured
with `BRANDING_ASSET_RATE_LIMIT_WINDOW_MS` (60000) and
`BRANDING_ASSET_RATE_LIMIT_MAX` (60). Rejections include 429/Retry-After.

Verification: `npm test -- --runInBand tests/organization`, `npm run lint`,
`npm run build`; tests exercise isolation, role gates, strict validation, reset,
transactional audit rollback, real local file uploads and route rate limits.
`npm run test:branding:mysql:isolated` with an explicit isolated
`PLATFORM_TEST_DATABASE_NAME` verifies actual tenant isolation, concurrent initial
upserts/uploads, FK/audit rollback and HTTP authorization. Database fixtures and
immutable audits are retained; no database is reset or dropped.
