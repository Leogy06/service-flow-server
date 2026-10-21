# Platform administration and subscription billing

## Purpose and scope

Platform operators manage organizations, plans, subscription entitlements,
verified manual receipts, refund requests, security and operational reporting.
Tenant customer invoices/payments are separate modules.

`GET /system-admin/subscriptions/count` returns `{ needsReview: number }` for
distinct subscriptions that are `PENDING` or have a `REQUESTED` upgrade. A single
database count with OR avoids double counting; reviewed upgrades alone do not
qualify. The route inherits authentication, persisted platform authority and the
global API limiter; the service checks platform authority before its live query.

`GET /system-admin/payments/count` returns `{ needsReview: number }` for subscription
receipts in `PENDING` or `UNDER_REVIEW`, matching dashboard pending verifications.
Finalized receipts are excluded. It uses a live count with the same router
authentication/system-admin guard, persisted service authority and global API
limiter as the subscription count. Tenant invoice payments remain separate.

The platform dashboard uses a 30-second Redis cache, and the shared plan catalog
uses the default five minutes. Persisted platform authority is checked before
cache access. Platform transactions invalidate dashboard activity after commit;
plan, subscription and user-security mutations additionally invalidate dependent
plan choices or user/staff views. Administrative lists/details, audit logs, signup
review/counts, financial exports and entitlement checks remain live. Monitoring
keeps its existing health-probe cache and live traffic. See `backend/docs/CACHING.md`.

Public signup requests are platform-owned applications, separate from tenant
users. `signup.*` validates, lists/counts and reviews applications. Only persisted
system administrators may inspect them. Signup uses configurable Redis
`signupLimiter`, independently of login/refresh; review uses the shared
write limiter. Deploy `20261017090000_public_signup_requests` and generate Prisma.

Approval locks the request and atomically creates a new organization, the shared
Admin/Manager/Staff defaults, one tenant administrator and a selected-plan
subscription (optional 14-day trial). No existing tenant can be joined publicly.
Rejected requests create no account. Both decisions clear the application hash
and append platform audits without credentials; identical decision retries do not
duplicate provisioning. Duplicate public emails return the same 202 response and
never overwrite pending details. Email notifications are not sent.

Signup requires explicit current Terms acceptance and Privacy Notice acknowledgment.
`constants/legal.ts` identifies matching public document versions. Server timestamp,
terms version and privacy version are stored with the application and audited in
the same transaction, exposed only to platform reviewers, and retained on review.
Legacy null evidence is never backfilled; approval returns 409 until the original
applicant resubmits their original credentials and current acknowledgments. This
password-verified, locked recovery changes only wholly missing evidence and appends
`signup.agreement.recorded`; partial/present evidence is preserved. Keep published
versions in the retained version lists when releasing new documents so earlier valid
applications remain reviewable. Deploy `20261017100000_signup_legal_acceptance` and
regenerate Prisma. Existing tenants do not receive a new login gate.

## Key files

Product feedback is routed through `../feedback/feedback.routes.ts` with the same
persisted platform guard and an additional authority check inside service
transactions. Tenant customer feedback is excluded from the platform inbox.

- `billing.routes.ts`, `billing.schema.ts`, `billing.service.ts`: billing contracts and transactions.
- `billing-policy.ts`, `entitlement.ts`: exact pricing, paid intervals, trials and access checks.
- `platform-audit.ts`: organization locks, transaction retries and immutable audits.
- `operations.service.ts`: revenue reports, monitoring and alerts.
- Prisma `SubscriptionPayment`, `SubscriptionRefundRequest`, `SubscriptionRefund`.
- `../../../tests/system-admin/`: service, schema, route and isolated MySQL coverage.
- `../../../docs/SYSTEM_ADMIN.md`: complete manual billing policy and deployment notes.

## Rules and considerations

- Require database-backed platform authority before lookups and inside mutations.
  Tenant roles and editable permissions never grant platform authority.
- Financial mutations lock the payment's organization and commit with the audit.
- New receipts must match the selected plan price/currency. Verification grants
  coverage exactly once. Calendar billing and one-time trials follow existing policy.
- Refunds are full-payment only: REQUESTED → APPROVED → COMPLETED; REQUESTED or
  APPROVED may become REJECTED. Only completion creates a financial refund and
  recalculates paid coverage. Request/review stages must preserve access/revenue.
- Validate the request belongs to the route's payment. Use separate exact request
  and completion retry keys; one open request and one financial refund per payment.
- Rejection retains history and allows a fresh request. Completed requests are final.
- Use shared write and per-operator refund rate-limit middleware. Return 429 with
  Retry-After; refund limits come from environment configuration.

## Known gotchas

- Bootstrap and alert CLIs use the central typed environment and selected mode
  file, just like the API. Set NODE_ENV explicitly for production; see
  `../../../docs/ENVIRONMENT.md`. No operator credentials are loaded from `.env`.

- Deploy `20261016140000_subscription_refund_requests` and regenerate Prisma.
  Existing refunds keep a nullable request link. Completion requires requestId.
- The app records externally returned funds; it does not initiate money transfers.
- Revenue is derived from immutable receipts/refunds, never pending requests.
- Refunding current/future coverage can revoke immediate tenant access. Preserve
  coverage-chain, historical-period and canceled-subscription rules.
- Payment detail responses include at most 20 refund requests. All history is audited.
- Run MySQL tests only against the explicitly isolated test database; audit fixtures
  are retained because platform audit rows cannot be changed or deleted.
- `bootstrap.ts` shares operator input/ownership checks between the standalone
  bootstrap and the explicit `seed:prod` setup. Production seeding adds only global
  permissions and a system administrator (required role/audits included); no plans
  or tenants. Existing active platform accounts are preserved on seed retries;
  standalone bootstrap still rejects duplicate emails. Never promote a tenant
  identity or reactivate blocked/deleted accounts by reusing an email.
