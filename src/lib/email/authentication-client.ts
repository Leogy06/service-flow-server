import { Resend, type Response as ResendResponse } from "resend";
import { env } from "@/config/env";

class AuthenticationEmailClient extends Resend {
  override async fetchRequest<T>(path: string, options: RequestInit = {}): Promise<ResendResponse<T>> {
    // The SDK logs provider error bodies outside production. They may echo codes,
    // so sensitive email uses its public transport hook without reading failures.
    try {
      const response = await fetch(`${this.baseUrl}${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("Delivery rejected");
      const data: T = await response.json();
      return { data, error: null, headers: Object.fromEntries(response.headers.entries()) };
    } catch {
      throw new Error("Unable to send verification email");
    }
  }
}

let client: AuthenticationEmailClient | undefined;
export function getAuthenticationEmailClient() {
  return client ??= new AuthenticationEmailClient(env.RESEND_API_KEY);
}
