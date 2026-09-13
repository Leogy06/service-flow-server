// templates/invite-user.ts
export function inviteUserHtml({
  firstName,
  inviteUrl,
}: {
  firstName: string;
  inviteUrl: string;
}) {
  return `
    <div>
      <p>Hi ${firstName}, you're invited to join.</p>
      <a href="${inviteUrl}">Set your password</a>
      <p>Link expire in 24 hour.</p>
    </div>
  `;
}
