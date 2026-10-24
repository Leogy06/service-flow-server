// send-invite.ts
import { env } from "@/config/env";
import { resend } from "./client";
import { emailLogoAttachment } from "./branding";
import { inviteUserHtml } from "./templates/invite-user";

interface SendInviteEmailProps {
  to: string; //email to be sent the invite
  firstName: string;
  token: string;
}

export async function sendInviteEmail({
  to,
  firstName,
  token,
}: SendInviteEmailProps) {
  const inviteUrl = `${env.CORS_ORIGIN}/set-password?token=${token}&email=${encodeURIComponent(to)}`;

  try {
    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: "You’re invited to join ServiceFlow",
      html: inviteUserHtml({ firstName, inviteUrl }),
      attachments: [emailLogoAttachment],
    });
    if (error || !data?.id) throw new Error("Invitation delivery failed");
    return data;
  } catch {
    // Provider failures may contain recipient or request details, including links.
    throw new Error("Invitation delivery failed");
  }
}
