# Transactional emails

## Purpose and scope

ServiceFlow account emails use a shared teal-accented, table-based HTML layout with
inline styles, system fonts, a hidden inbox preheader, a primary action and a
copyable fallback URL. The header pairs the selected Handoff ServiceFlow mark
with live brand text and an inline PNG attachment, avoiding remote image downloads.
No additional packages are required.

## Key files

- `send-invite.ts`: existing Resend delivery and invitation URL construction.
- `branding.ts`: bundled PNG and matching Content-ID for inline email attachments.
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
- Both templates use the shared header. Its decorative 48px raster mark references
  `cid:serviceflow-brand`. Every delivery call using these templates must include
  `attachments: [emailLogoAttachment]` from `branding.ts`; invitation delivery does so.
  Resend matches the attachment's `contentId` to the HTML image reference.
- The original 96px `frontend/public/service-flow-logo/handoff/email-mark.png` is
  stored as base64 in `branding.ts`, so the built backend and Docker runtime need
  no frontend checkout, static-asset copy or public image server. The 1,355-byte PNG
  has an opaque white background for light/dark contrast. Update its base64 and the
  delivery test's asset hash together when intentionally replacing this logo.
  Tokens and recipient details never enter the image reference or attachment.
  Do not use CSS clipping, SVG, theme switching or image-only brand text in headers.

## Known gotchas

The reset template is presentation only. `send-reset-password.ts` is still an
empty placeholder; the current administrator-driven staff password reset sets a
password directly and does not send a reset email. Do not assume this template
enables an email reset flow. Future reset delivery must enforce its own token,
expiry, ownership and request rules. Actual Gmail/Outlook rendering needs an inbox
check; browser previews alone cannot establish client compatibility.
Opening raw template HTML in a browser cannot resolve `cid:` images without their
attachments. For a local visual preview only, replace the CID with the bundled
PNG's data URL; sent email must keep the CID and matching attachment. Some mail
clients may still hide images according to their own settings.
