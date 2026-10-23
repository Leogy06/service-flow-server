import { codeEmailHtml } from "./layout";

export type LoginCodeSurface = "tenant" | "system-admin";

interface LoginCodeProps {
  firstName: string;
  code: string;
  surface: LoginCodeSurface;
  organizationName?: string | null;
  expiresInMinutes: number;
}

function content(props: LoginCodeProps) {
  const destination = props.surface === "system-admin"
    ? "ServiceFlow administration"
    : props.organizationName?.trim()
      ? `${props.organizationName.trim()} on ServiceFlow`
      : "your ServiceFlow workspace";
  const expiry = `${props.expiresInMinutes} ${props.expiresInMinutes === 1 ? "minute" : "minutes"}`;
  return {
    message: `Continue signing in to ${destination} with the code below.`,
    notice: `This code expires in ${expiry}. Use it only on the sign-in screen where you requested it.`,
    securityNote: "Never share this code. ServiceFlow will never ask you to send it to someone. If you didn't request this code, you can ignore this email.",
  };
}

export function loginCodeHtml(props: LoginCodeProps): string {
  return codeEmailHtml({
    preheader: "Use your verification code to complete your ServiceFlow sign-in.",
    eyebrow: "Account security",
    title: "Verify your sign-in.",
    firstName: props.firstName,
    code: props.code,
    ...content(props),
  });
}

export function loginCodeText(props: LoginCodeProps): string {
  const copy = content(props);
  return [
    props.firstName.trim() ? `Hi ${props.firstName.trim()},` : "Hi there,",
    copy.message,
    props.code,
    copy.notice,
    copy.securityNote,
    "ServiceFlow",
  ].join("\n\n");
}
