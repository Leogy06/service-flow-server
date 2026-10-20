# Authentication

`auth.routes.ts`, schemas, controller and service own public application, login,
refresh/logout and profile routes. `authorization.ts` reloads account, tenant,
permissions, security status and billing entitlement for protected requests.

Authentication, authorization and profile/session responses remain uncached.
Committed profile changes invalidate cached user lists, staff/job labels, role
choices, eligible plans and dashboards through `utils/module-cache.ts`; cache
state never determines authentication or permission decisions.

Public `POST /api/auth/register` now returns 202 with `data.submitted: true` and
queues a platform signup request through `system-admin/signup.service.ts`.
It accepts a business name and desired slug along with credentials, explicit
`termsAccepted: true`, `privacyAcknowledged: true`, and current `termsVersion` /
`privacyVersion` strings (`2026-10-17`). Privacy acknowledgment records receipt of
the notice, not blanket consent to all processing. Unknown authorization fields
and client acceptance timestamps are rejected. Both the route and service enforce
current document versions before database work. Configurable Redis signup limits, the existing
authentication limiter and the global API limiter cover it. No user or token is
created until a system administrator approves. Duplicate email submissions receive
the same response without replacing data. An original applicant may resubmit their
original signup email/password with the current acknowledgments to complete a
legacy PENDING request only when it has no prior acceptance evidence. The service
locks/rechecks the request, verifies its password hash and records evidence/audit
atomically; wrong passwords, reviewed requests and existing users receive the same
202 without changes. An application has no tenant access.

Existing login, HTTP-only refresh cookie, rotation, session-version and tenant
entitlement rules remain authoritative. The public signup confirmation explains
waiting for approval; unapproved applicants cannot log in. Tests are under
`tests/system-admin/signup.test.ts`, `tests/auth` and isolated signup MySQL checks.
The `business` workspace slug is reserved for public `/business/{slug}` pages;
registration and signup approval share the same validated slug definition.
Deploy additive `20261017100000_signup_legal_acceptance` and regenerate Prisma
before deploying the updated registration contract. Existing tenant login is unchanged.

Refresh-cookie `secure` is derived from the central validated `env.NODE_ENV`.
Backend mode files and production CORS/TLS requirements are documented in
`../../../docs/ENVIRONMENT.md`.
