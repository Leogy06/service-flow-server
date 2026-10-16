# Authentication

`auth.routes.ts`, schemas, controller and service own public application, login,
refresh/logout and profile routes. `authorization.ts` reloads account, tenant,
permissions, security status and billing entitlement for protected requests.

Public `POST /api/auth/register` now returns 202 with `data.submitted: true` and
queues a platform signup request through `system-admin/signup.service.ts`.
It accepts a business name and desired slug along with credentials; unknown
authorization fields are rejected. Configurable Redis signup limits, the existing
authentication limiter and the global API limiter cover it. No user or token is
created until a system administrator approves. Duplicate email submissions receive
the same response without replacing data. An application has no tenant access.

Existing login, HTTP-only refresh cookie, rotation, session-version and tenant
entitlement rules remain authoritative. The public signup confirmation explains
waiting for approval; unapproved applicants cannot log in. Tests are under
`tests/system-admin/signup.test.ts`, `tests/auth` and isolated signup MySQL checks.
