# Tenant-admin staff password recovery

Open **Users** in the tenant workspace, open the staff member's action menu and
choose **Reset password**. Confirm your own current password, enter and confirm
the new staff password, add an audit reason and confirm the reset.

The new password must have at least eight characters, an uppercase letter,
a lowercase letter and a number. It must fit within bcrypt's 72-byte limit and
must differ from the administrator's password. Share it with the staff member
privately. They can change it from **My profile > Password & security** after
signing in. This flow sets the password directly; it does not require email delivery.

Only an authenticated tenant administrator (Admin/Tenant Admin) with effective
`user:update` authority can perform the reset. The Users interface also requires
`user:read`. The server derives the organization from the authenticated actor
and rechecks their role, effective permissions, current password and account
version before committing the change.

The target must be an undeleted, activated staff account in the same tenant and
within the administrator's grantable authority. Self-service password changes
stay in My profile; other administrators, platform identities, protected staff,
pending invitations and foreign-tenant accounts cannot use this recovery route.
Resetting a blocked staff member's password preserves their security block.

On success, the application stores only the bcrypt hash, clears stale invitation
credentials, increments the staff account's session version and deletes its
tenant-scoped refresh sessions. Existing access JWTs fail the next authenticated
request. Roles, permissions, account status and business records are preserved.
The password change, session revocation and `auth.staff.password.reset.success`
tenant audit record commit atomically. An audit failure rolls everything back.
Passwords/hashes are excluded from the response and audit metadata. Request
logging uses the existing currentPassword/newPassword/confirmPassword redaction.

API: `POST /api/users/:id/reset-password`, with `currentPassword`, `newPassword`,
`confirmPassword`, `reason` and `confirm: true`. The response contains only target
`id` and `sessionsRevoked`. Unknown body fields are rejected. This route uses the
existing strict sensitive-action rate limiter. No database migration or new
permission seed is needed.

Verification:

```powershell
npm test -- --runInBand tests/user/password-reset.test.ts
```

The isolated platform MySQL runner also executes `tests/user/password-reset.mysql.mjs`.
Its fixtures and immutable audit records stay in the explicitly named test database.
Frontend checks: `npm run test:users:password-reset:browser` and
`npm run test:users:browser` from the frontend repository. No real user passwords
are changed by these tests.
