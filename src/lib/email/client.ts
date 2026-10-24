// src/lib/email/client.ts
import { getAuthenticationEmailClient } from "./authentication-client";

// Invitations carry account activation secrets, so use the same private transport.
export const resend = getAuthenticationEmailClient();
