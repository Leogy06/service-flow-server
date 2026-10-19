# Transactional emails

## Purpose and scope

ServiceFlow account emails use a shared red-accented, table-based HTML layout with
inline styles, system fonts, a hidden inbox preheader, a primary action and a
copyable fallback URL. The header pairs the supplied blue/teal ServiceFlow mark
with live brand text that remains visible when remote images are blocked.
No additional packages are required.

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
- Both templates use the shared header. Its decorative 48px raster mark is served
  by the frontend's existing `/_next/image` optimizer at 96px from
  `public/system-logo/2.png`. Only the action URL's trusted origin is reused;
  invitation/reset tokens and recipient query parameters never enter image URLs.
  Production needs the public frontend origin and image route reachable by mail
  clients. Localhost logos work only for local previews. Do not use CSS clipping,
  SVG, theme switching or image-only brand text in email headers.

## Known gotchas

The reset template is presentation only. `send-reset-password.ts` is still an
empty placeholder; the current administrator-driven staff password reset sets a
password directly and does not send a reset email. Do not assume this template
enables an email reset flow. Future reset delivery must enforce its own token,
expiry, ownership and request rules. Actual Gmail/Outlook rendering needs an inbox
check; browser previews alone cannot establish client compatibility.
