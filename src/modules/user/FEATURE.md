# Tenant users

Persisted demo organizations cannot add staff directly or send staff invitations.
The mode guard runs before account creation and again inside its transaction.
The provisioned demo owner's invitation acceptance and mandatory email login
verification retain the normal authentication flow.

User routes/controller, schema, `user.service.ts`, password service and platform
creation service manage accounts, invitations, profiles, archive/restore and
password reset. Tenant access policy and entitlement helpers enforce role scope,
effective permissions and seat limits. Security-sensitive changes preserve
transactional audits and session revocation.

Password changes/resets, invitation acceptance, account email changes and
archive/restore revoke outstanding email login challenges and all remembered
devices for the affected account in the same transaction. An email change also
invalidates outstanding invitations and existing access/refresh sessions; a new
login verifies the replacement mailbox. Password and email updates never disable
email verification or reactivate blocked accounts.

User lists and role choices use shared Redis caching. The internal `getById`
lookup validates mutations and deliberately reads live database state. User/profile
and access mutations refresh user lists, role choices, staff/job labels, eligible
upgrade plans and affected dashboards. Permission-management data remains live;
cache hits never determine authorization. See `backend/docs/CACHING.md`; tests are
under `tests/user`, `tests/auth`, `tests/access-management` and `tests/cache`.
