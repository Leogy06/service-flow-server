import { actionEmailHtml } from "./layout";

export function inviteUserHtml({
  firstName,
  inviteUrl,
}: {
  firstName: string;
  inviteUrl: string;
}) {
  return actionEmailHtml({
    preheader: "You're invited to ServiceFlow. Set your password to get started.",
    eyebrow: "You're invited",
    title: "Good work starts here.",
    firstName,
    message:
      "You've been invited to join your team on ServiceFlow. Set your password to access your workspace and start managing service together.",
    actionLabel: "Set your password",
    actionUrl: inviteUrl,
    notice:
      "Your invitation link expires in 24 hours. If it has expired, ask your administrator for a new invitation.",
    securityNote:
      "Keep this invitation private. If you weren't expecting it, you can safely ignore this email.",
  });
}
