# Tenant provisioning

Platform operators create a new, isolated workspace from one of six versioned
industry templates: AIRCON, AUTO_REPAIR, APPLIANCE_REPAIR, CLEANING, GENERAL or
GIFTS_SURPRISE_DELIVERY (Gifts & Surprise Delivery).
Public signup approval remains a separate legal-evidence review workflow.

## API and ownership

The parent system-admin router enforces authentication, the shared API limiter
and persisted platform authority. Every service reloads authority; mutations
also check it inside the transaction and use the shared write limiter.

- `GET /system-admin/provisioning/templates`: reviewed template catalog.
- `GET /system-admin/provisioning/templates/:templateId`: one validated template.
- `POST /system-admin/provisioning`: provision with a UUID retry key and confirmation.
- `GET /system-admin/provisioning/:id`: safe persisted status and current counts.
- `POST /system-admin/provisioning/:id/invitation`: rotate and resend a pending owner invite.
- `POST /system-admin/provisioning/:id/reset-demo`: restore generated sample scenarios.

`provisioning.schema.ts` validates nested organization/owner details, mode, template,
plan/trial options, sample-data and draft-page choices, operator reason and explicit
confirmation. Unknown tenant selectors and privilege fields are rejected.

## Atomicity and retry behavior

`TenantProvisioning.id` hashes the persisted actor ID and retry key. A separate
hash binds that key to the normalized full request. Exact retries return the same
workspace; changed requests return 409. Unique constraints and serializable
transactions protect concurrent retries. Failed provisioning rolls back the
organization, roles, owner, subscription, catalog, draft, samples and audit.

`default-roles.ts` shares the established Admin/Manager/Staff role initialization
with signup approval. Global permission definitions must already exist. Starter
services have base price zero and remain inactive until the owner confirms pricing.
Generated websites contain draft content only and leave contact/location fields empty.

REAL requires an active plan. Its optional 14-day trial starts at provisioning,
matching signup approval. Without a trial, existing entitlement checks require
verified paid access before owner invitation acceptance. DEMO disables billing and
may generate fictional sample workflows; it never creates a subscription.

## Invitations and sample safety

Owner accounts start PENDING with no password and no platform authority. Delivery
runs after commit using the existing CID email and public set-password flow. Only
a SHA-256 token hash is stored. Raw tokens never enter API results, records, audits
or logs. A durable five-minute attempt lease serializes retries; completion compares
the attempt ID so stale deliveries cannot overwrite a newer attempt's status.
Delivery failure preserves the workspace and a fixed safe error for operator retry.
Accepted, archived, blocked or foreign-role owners cannot receive a new invitation.

`demo-fixtures.ts` creates three fictional customers, requests and jobs, two example
invoices and two recorded sample payments. Contacts use reserved example values;
tracking tokens remain null and no payment provider or sample-customer email runs.
Each manifest tracks exact generated IDs. Reset locks the demo organization, rejects
custom rows linked to samples, removes only manifest-owned operational records,
recreates the original scenarios and appends an audit atomically. It preserves
organization/owner/roles/catalog/website and unrelated custom records.

## Verification

`tests/system-admin/provisioning*.test.ts` covers schemas, template relevance,
authority, atomic rollback, retry binding, invite delivery/lease recovery, fixture
segregation/reset, route validation and middleware 429/Retry-After behavior.
Real database concurrency and migration checks use the isolated MySQL harness.
No migration, mailbox acceptance or hosted deployment is implied by unit checks.
