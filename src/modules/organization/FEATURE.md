# Organization settings and branding

Persisted demo organizations can save private page drafts but cannot publish.
Public page lookup returns the same 404 for demo, missing and unpublished pages,
including previously published snapshots. Paid upgrade discovery, requests and
platform upgrade review also reject demo organizations through the shared guard.

Organization routes cover platform provisioning, tenant subscriptions and tenant
branding. Existing organization names/slugs and billing workflows retain their
contracts; branding display names never rename an organization or change URLs.

## Public business pages

`page.{schema,service,controller,routes}.ts` add authenticated tenant-admin
`GET/PUT /api/organization/page` and anonymous
`GET /api/organization/public-page/:slug`. The optional one-to-one
`OrganizationPage` stores separate validated draft/published JSON, publishedAt and
an updatedAt revision. Missing rows return an empty private draft without writing.
PUT accepts only content, nullable ISO version and publication (`keep`, `publish`,
`unpublish`). Strict schemas reject tenant selectors and unknown content fields.
Stale revisions return 409, including concurrent first saves. All writes and
tenant audits commit in a serializable transaction; audits record operation and
revision without copying contact details. No new permission grants.

Publishing requires headline, introduction, at least one named service, location,
and public phone or email. Service names/descriptions are deliberately separate
from internal service types; no private contacts are automatically copied. Save
draft preserves the published snapshot; unpublish clears it and its timestamp.
Public responses explicitly select only name/slug/brand and published content.
Missing, unpublished and suspended tenants return the same 404. Both draft and
public reads are live and responses use no-store so publication, status and
revision checks cannot use stale caches. Public pages render escaped plain text.

Public content also accepts optional coverImageUrl, facebookUrl, instagramUrl,
linkedinUrl and googleMapsUrl. Missing keys in existing JSON or older clients
default to empty strings; no additional migration is required. URLs must be public
HTTPS links without credentials or custom ports, at most 2048 characters. Social
profiles use exact base/www Facebook (facebook.com/fb.com), Instagram and LinkedIn
hosts; Maps accepts Google /maps URLs, maps.google.com, maps.app.goo.gl and
goo.gl/maps links. Cover photos load directly in the visitor's browser; the API
never fetches tenant-selected image URLs. Draft/publication/audit rules are unchanged.

Routes inherit global apiLimiter; PUT adds writeLimmiter, public GET adds the
Redis IP publicPageLimiter configured by PUBLIC_PAGE_RATE_LIMIT_WINDOW_MS (60000)
and PUBLIC_PAGE_RATE_LIMIT_MAX (60). Limits retain 429/Retry-After responses.
Deploy `20261018040000_organization_page` and regenerate Prisma before use.
`npm test -- --runInBand tests/organization` covers isolation, admin/anonymous
gates, snapshots, validation, revision conflicts, audit rollback and rate limits.
`npm run test:website:mysql:isolated` with an explicit isolated
PLATFORM_TEST_DATABASE_NAME verifies real FK/audit rollback, concurrent first saves
and edits, forged tenant claims, publication and suspension; retains test fixtures.

The `business` workspace slug is reserved in registration/approval and direct
provisioning to protect the new public route namespace. Before deploying to another
environment, verify no existing organization uses that slug. The local development
database was checked and has no collision; no existing tenant was renamed.

## Branding

Branding settings and eligible upgrade-plan choices use shared Redis caching;
settings/uploads/removal, seat/role changes and plan/subscription mutations
invalidate their dependent data after commit. Eligible-plan service guards still
reload the actor before a cache hit. Subscription entitlement summaries and public
asset-reference checks remain live. See `backend/docs/CACHING.md`.

`branding.routes.ts`, schema, controller and service implement authenticated
`GET/PATCH /api/organization/settings`, `POST/DELETE /settings/logo` and
`POST/DELETE /settings/favicon`. Reads are available to every active tenant user;
writes require the trusted existing Admin/Tenant Admin role. Platform sessions
cannot use tenant settings. Tenant identity always comes from authentication
context, and strict schemas reject client organization selectors and asset URLs.
No new permission grants are introduced. Settings changes and tenant audits
commit together using the existing serializable tenant transaction helper.

Settings are an optional one-to-one `OrganizationSettings` relation. Missing rows
return Handoff teal `#0d887d`, null display name/assets/timestamps without a GET write.
PATCH accepts a six-digit hex `primaryColor` and nullable `displayName` (1–100
characters); null restores the color/name default. Responses use the standard
data envelope and include organizationId, primaryColor, displayName, logoUrl,
faviconUrl, createdAt and updatedAt. Null assets use Service Flow defaults.

Existing saved colors, including red, are preserved. New partial settings writes
explicitly use teal. The branding cache key includes the fallback color so old
cached defaults are not reused after this change. Public pages share the same
fallback. Deploy `20261019120000_handoff_default_color` to align the database
default for future inserts; it changes no existing records.

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
