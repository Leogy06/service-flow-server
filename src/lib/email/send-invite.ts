// send-invite.ts
import { env } from "@/config/env.js";
import { resend } from "./client.js";
import { inviteUserHtml } from "./templates/invite-user.js";

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

  const { data, error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: "You’re invited to join ServiceFlow",
    html: inviteUserHtml({ firstName, inviteUrl }),
  });

  if (error) {
    console.error("Error sending invite email", error);
    throw error;
  }

  return data;
}
