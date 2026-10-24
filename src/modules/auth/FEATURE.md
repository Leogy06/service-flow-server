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
current document versions before database work. The dedicated strict, fail-closed
Redis signup limiter covers it independently of login and refresh. No user or token is
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

Login uses `authLimiter` (10 failed attempts/15 minutes by IP); successful 2xx
responses are decremented. Mandatory email verification now gates new sessions;
see [configuration, API contract and recovery](../../../docs/EMAIL_TWO_FACTOR.md).
`two-factor.service.ts` stores keyed code hashes and opaque challenge hashes,
serializes code consumption with session creation, and enforces resend/attempt
budgets. `login-session.ts` issues tokens after factor verification or a scoped
trusted-device match. Device routes use authenticated read/write/strict policies.
Credential/access changes and logout-all revoke factors transactionally.
Login/resend also share strict Redis IP/account budgets. IP protection runs before
credential work; the shared account budget runs only after server-side password
or current resend-challenge proof. Wrong passwords and stale handles cannot
deplete another account's delivery budget. Credential/state checks remain inside
the issuance transaction; retries charge Redis once. Verification has a
separate strict IP limiter. Refresh uses a
separate `refreshLimiter` (60/minute), keyed by a signature-verified access-token
subject when supplied, otherwise IP. An expired access token may identify that
budget only; the refresh service still validates/rotates the HTTP-only cookie.
Signup, refresh, password actions and all write policies fail closed with a safe
503 if Redis is unavailable. General `apiLimiter` runs after `authenticate` on
private profile/session routes and fails open. Limits and deployment checks are
in `../../../docs/RATE_LIMITING.md`; server authorization remains live.

Logout clears both current and legacy browser refresh-cookie paths before its
public limiter, so a blocked revocation request cannot silently restore this
browser's session. Server-side token revocation still runs behind the guard;
failures remain errors rather than claiming revocation succeeded.
