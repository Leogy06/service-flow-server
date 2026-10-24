import { EMAIL_LOGO_CONTENT_ID } from "../branding";

interface EmailProps {
  preheader: string;
  eyebrow: string;
  title: string;
  firstName: string;
  message: string;
  notice: string;
  securityNote: string;
}

interface ActionEmailProps extends EmailProps {
  actionLabel: string;
  actionUrl: string;
}

interface CodeEmailProps extends EmailProps {
  code: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** All content is plain text; escape it before inserting into email HTML. */
export function actionEmailHtml(props: ActionEmailProps): string {
  return emailHtml(props, { label: props.actionLabel, url: props.actionUrl });
}

/** Display a copyable verification code within the same account-email design. */
export function codeEmailHtml(props: CodeEmailProps): string {
  return emailHtml(props, { code: props.code });
}

function emailHtml(
  props: EmailProps,
  action: { label: string; url: string } | { code: string },
): string {
  let actionUrl = "";
  if ("url" in action) {
    const url = new URL(action.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Email action URL must use HTTP or HTTPS");
    }
    actionUrl = escapeHtml(action.url);
  }
  const firstName = escapeHtml(props.firstName.trim());
  // Delivery must include emailLogoAttachment; the logo needs no remote image request.
  const logoSource = `cid:${EMAIL_LOGO_CONTENT_ID}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(props.title)} | ServiceFlow</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    @media screen and (max-width: 600px) {
      .email-shell { padding: 24px 12px !important; }
      .email-content { padding: 28px 24px !important; }
      .email-heading { font-size: 28px !important; line-height: 36px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; width: 100%; background-color: #f5f5f4; color: #292524; font-family: Arial, Helvetica, sans-serif;">
  <div style="display: none; font-size: 1px; line-height: 1px; color: #f5f5f4; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all;">${escapeHtml(props.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f5f4" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td class="email-shell" align="center" style="padding: 48px 20px;">
        <!--[if mso]><table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 560px; border-collapse: separate;">
          <tr>
            <td style="padding: 0 0 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse: collapse;">
                <tr>
                  <td width="48" valign="middle" style="width: 48px; font-size: 0; line-height: 0;">
                    <img src="${logoSource}" alt="" width="48" height="48" border="0" style="display: block; width: 48px; height: 48px; border: 0; border-radius: 6px; background-color: #ffffff;" />
                  </td>
                  <td valign="middle" style="padding-left: 12px; font-size: 22px; line-height: 30px; font-weight: 700; letter-spacing: -0.7px; color: #1c1917;">ServiceFlow</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-content" bgcolor="#ffffff" style="padding: 40px; background-color: #ffffff; border: 1px solid #e7e5e4; border-top: 4px solid #08786f; border-radius: 8px;">
              <p style="margin: 0 0 14px; color: #08786f; font-size: 11px; line-height: 18px; font-weight: 700; letter-spacing: 1.8px; text-transform: uppercase;">${escapeHtml(props.eyebrow)}</p>
              <h1 class="email-heading" style="margin: 0 0 28px; color: #1c1917; font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -1px;">${escapeHtml(props.title)}</h1>
              <p style="margin: 0 0 12px; font-size: 15px; line-height: 25px;">${firstName ? `Hi ${firstName},` : "Hi there,"}</p>
              <p style="margin: 0 0 28px; color: #57534e; font-size: 15px; line-height: 25px;">${escapeHtml(props.message)}</p>
              ${"code" in action ? `<p style="margin: 0 0 28px; padding: 20px 24px; border: 1px solid #e7e5e4; border-radius: 6px; background-color: #fafaf9; color: #08786f; font-family: 'Courier New', Courier, monospace; font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: 6px; text-align: center;">${escapeHtml(action.code)}</p>` : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; margin: 0 0 28px;">
                <tr>
                  <td align="center" bgcolor="#08786f" style="background-color: #08786f; border: 1px solid #08786f; border-radius: 6px; mso-padding-alt: 14px 24px;">
                    <a href="${actionUrl}" style="display: inline-block; padding: 14px 24px; border-radius: 6px; color: #ffffff; font-size: 15px; line-height: 22px; font-weight: 700; text-align: center; text-decoration: none; mso-padding-alt: 0;"><span style="color: #ffffff;">${escapeHtml(action.label)}</span></a>
                  </td>
                </tr>
              </table>`}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td bgcolor="#fafaf9" style="padding: 14px 16px; border-left: 3px solid #08786f; color: #57534e; font-size: 13px; line-height: 21px;">${escapeHtml(props.notice)}</td>
                </tr>
              </table>
              ${"url" in action ? `<p style="margin: 28px 0 8px; color: #78716c; font-size: 12px; line-height: 20px;">If the button doesn&rsquo;t work, copy and paste this link into your browser:</p>
              <p style="margin: 0; font-size: 12px; line-height: 20px; word-break: break-all; overflow-wrap: anywhere;">
                <a href="${actionUrl}" style="color: #08786f; text-decoration: underline; word-break: break-all; overflow-wrap: anywhere;">${actionUrl}</a>
              </p>` : ""}
              <p style="margin: 28px 0 0; padding-top: 24px; border-top: 1px solid #e7e5e4; color: #78716c; font-size: 12px; line-height: 20px;">${escapeHtml(props.securityNote)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 8px 0; color: #78716c; font-size: 12px; line-height: 20px;">
              <p style="margin: 0 0 4px; font-weight: 700; color: #57534e;">Your service business, organized.</p>
              <p style="margin: 0;">&copy; ${new Date().getFullYear()} ServiceFlow. All rights reserved.</p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}
