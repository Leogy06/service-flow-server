import { actionEmailHtml } from "./layout";

export function resetPasswordHtml({
  firstName,
  resetUrl,
}: {
  firstName: string;
  resetUrl: string;
}) {
  return actionEmailHtml({
    preheader: "Use this link to reset your ServiceFlow password.",
    eyebrow: "Account security",
    title: "A fresh start for your password.",
    firstName,
    message:
      "We received a request to reset the password for your ServiceFlow account. Use the button below to choose a new password.",
    actionLabel: "Reset your password",
    actionUrl: resetUrl,
    notice:
      "Keep this link private. Never share your password or password-reset link with anyone.",
    securityNote:
      "If you didn't request a password reset, you can safely ignore this email. Your password won't change unless you complete the reset.",
  });
}
