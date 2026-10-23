import { env } from "@/config/env";
import { emailLogoAttachment } from "./branding";
import { getAuthenticationEmailClient } from "./authentication-client";
import { loginCodeHtml, loginCodeText, type LoginCodeSurface } from "./templates/login-code";

/** The caller generates and stores the code securely before requesting delivery. */
export async function sendLoginCodeEmail(
  to: string,
  name: string,
  code: string,
  surface: LoginCodeSurface,
  organizationName?: string | null,
  expiresInMinutes = 10,
): Promise<void> {
  const props = { firstName: name, code, surface, organizationName, expiresInMinutes };
  try {
    const { data, error } = await getAuthenticationEmailClient().emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: surface === "system-admin"
        ? "Verify your ServiceFlow administration sign-in"
        : "Verify your ServiceFlow sign-in",
      html: loginCodeHtml(props),
      text: loginCodeText(props),
      attachments: [emailLogoAttachment],
    });
    if (error || typeof data?.id !== "string" || !data.id) throw new Error("Delivery rejected");
  } catch {
    // Provider errors can contain recipient or request details, including the code.
    throw new Error("Unable to send verification email");
  }
}
