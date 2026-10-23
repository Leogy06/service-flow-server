# Email verification at login

Both login surfaces use the shared form. The backend derives the surface from
the account's current platform role. A valid password returns the completed login
response or `requiresTwoFactor: true` with an opaque challenge handle, masked
email, code length, expiration, resend availability, trust duration and delivery
status. Challenges cannot authorize protected routes or create refresh sessions.

`POST /api/auth/2fa/verify` accepts `{ challengeId, code, rememberDevice }` and
completes login. `POST /api/auth/2fa/resend` accepts `{ challengeId }`, invalidates
the previous code and returns a replacement challenge. Replace the old handle and
use the latest email. Verification errors are generic. Delivery failures leave a
retryable challenge and never create a session.

## Configuration

Backend environment options are validated at startup:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TWO_FACTOR_CODE_LENGTH` | `4` | Numeric digits, 4–8; set `6` for six digits. |
| `TWO_FACTOR_CODE_TTL_SECONDS` | `600` | Expiry, 60–600 seconds. |
| `TWO_FACTOR_MAX_ATTEMPTS` | `5` | Failed guesses per code, 1–5. |
| `TWO_FACTOR_RESEND_SECONDS` | `60` | Account cooldown, at least 60 seconds. |
| `TWO_FACTOR_SEND_MAX_PER_HOUR` | `5` | Shared IP/account request and persistent issuance budget. |
| `TWO_FACTOR_SECRET` | access JWT secret | Dedicated HMAC key, if set, at least 32 characters. |
| `TRUSTED_DEVICE_TENANT_DAYS` | `30` | Fixed tenant trust lifetime, 1–90 days. |
| `TRUSTED_DEVICE_ADMIN_DAYS` | `7` | Fixed platform trust lifetime, 1–30 days. |
| `TWO_FACTOR_VERIFY_RATE_LIMIT_WINDOW_MS` | `600000` | Verification IP window. |
| `TWO_FACTOR_VERIFY_RATE_LIMIT_MAX` | `30` | Verification requests per IP window. |

Use a randomly generated dedicated HMAC secret in production. Rotating it
invalidates outstanding codes. Keep the existing Resend key and verified
`EMAIL_FROM`. The new code template reuses the shared layout, inline logo and
plain-text counterpart; tenant names supply context when available.

Login/resend share fail-closed Redis IP/account middleware, counting unsuccessful
requests and trusted-device password logins too. This conservative request budget
can also limit repeated trusted logins from a shared IP. Database checks preserve
the cooldown and rolling hourly issuance budget across fresh login and resend.
Verification has an additional persistent five-guess budget. Use the established
proxy trust configuration. Rate-limit errors include `Retry-After`.

## Remembered devices

Raw tokens appear only in `trustedDeviceTenant` / `trustedDeviceAdmin` cookies:
`HttpOnly`, `SameSite=Strict`, `/api/auth`, `Secure` in production. Local HTTP
development follows the existing insecure-cookie exception. Only SHA-256 hashes
are stored. Trust must match user, organization, surface, user agent, unrevoked
status and fixed expiry. IP changes update last use and never extend trust.
The password is always required.

Both account settings screens expose `GET /api/auth/trusted-devices`,
`DELETE /api/auth/trusted-devices/:id` and `DELETE /api/auth/trusted-devices`.
Revoking trust affects the next login. `POST /api/auth/logout-all` also revokes
active sessions. Password/email changes, staff resets, invitation activation or
reissue and account/tenant access revocation invalidate factors transactionally.

## Recovery

Tenant users contact their organization administrator. After verifying identity
through an established independent channel, the authorized administrator corrects
the email in user management and, if needed, uses the existing staff password
reset. A password reset alone never bypasses email verification. An unauthenticated
email request is not proof of ownership.

System-admin recovery requires an authorized infrastructure operator with server
and database access, plus independent identity verification. There is no public
recovery or factor-bypass endpoint. The private CLI defaults to dry run:

```powershell
npm.cmd run recover:account -- --email=old@example.com --new-email=verified@example.com --reason="Identity verified through the established operator process" --identity-verified
# Review the dry run, then repeat with explicit --apply:
npm.cmd run recover:account -- --email=old@example.com --new-email=verified@example.com --reason="Identity verified through the established operator process" --identity-verified --apply
```

Apply changes the email, increments the session version, revokes refresh sessions,
device trust and pending codes, and writes an OPERATOR audit. Normal password plus
email verification remains required. Restrict operator access and document the
independent verification process outside this application.

## Deployment and acceptance

Review/apply additive migration `20261023160000_email_two_factor` using the existing
environment-specific procedure, regenerate Prisma, then deploy backend and frontend
together because login now returns a union. No reset is needed. Existing valid
sessions continue until expiry or revocation; the next password login uses 2FA.

Retain challenges for at least an hour to preserve issuance budgets. Expired
challenges and expired/revoked devices may be removed by an operator retention job
after considering audit retention. No cleanup scheduler is introduced here.

Automated fixtures cover expiry, attempts, replay, concurrent verification,
replacement/cooldown/budgets, delivery failure, trust scope, revocation and recovery.
Live MySQL concurrency, real Resend delivery and hosted cookies require deployment
acceptance. References: [OWASP OTP handling](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)
and [Node cryptographic randomness](https://nodejs.org/api/crypto.html#cryptorandomintmin-max-callback).
