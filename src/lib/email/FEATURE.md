# Transactional emails

## Purpose and scope

ServiceFlow account emails use a shared red-accented, table-based HTML layout with
inline styles, system fonts, a hidden inbox preheader, a primary action and a
copyable fallback URL. No remote images or additional packages are required.

## Key files

- `send-invite.ts`: existing Resend delivery and invitation URL construction.
- `templates/layout.ts`: shared presentation, HTML escaping and HTTP(S) URL guard.
- `templates/invite-user.ts`: existing `inviteUserHtml({ firstName, inviteUrl })` API.
- `templates/reset-password.ts`: `resetPasswordHtml({ firstName, resetUrl })`.

## Rules and considerations

- All layout props are plain text and are escaped before HTML interpolation,
  including link attributes and visible URLs. Action URLs must be absolute HTTP(S)
  URLs; callers remain responsible for choosing a trusted application origin.
- Invitation copy reflects the existing 24-hour expiry in the user service.
- Templates perform no data access, tenant lookup, token generation or delivery.
  Never pass passwords or unnecessary private information into email content.
- Preserve inline styles and presentation tables when editing for email clients.

## Known gotchas

The reset template is presentation only. `send-reset-password.ts` is still an
empty placeholder; the current administrator-driven staff password reset sets a
password directly and does not send a reset email. Do not assume this template
enables an email reset flow. Future reset delivery must enforce its own token,
expiry, ownership and request rules. Actual Gmail/Outlook rendering needs an inbox
check; browser previews alone cannot establish client compatibility.
