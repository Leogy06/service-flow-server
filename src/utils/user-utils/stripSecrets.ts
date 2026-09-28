const SECRET_FIELDS = ["password", "inviteToken", "inviteTokenExpiry"] as const;
type SecretField = (typeof SECRET_FIELDS)[number];

export function stripSecrets<T extends object>(user: T): Omit<T, SecretField> {
  const copy = { ...user } as Record<string, unknown>;
  for (const key of SECRET_FIELDS) delete copy[key];
  return copy as Omit<T, SecretField>;
}
