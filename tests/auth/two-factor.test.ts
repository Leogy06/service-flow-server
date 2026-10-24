import { jest } from "@jest/globals";
import { createHash } from "node:crypto";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let now = new Date("2026-10-23T12:00:00Z");
let challenges: any[];
let devices: any[];
let sessions: any[];
let audits: any[];
let sentCodes: string[];
let deliveryFails: boolean;
let current: any;
function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("gt" in value) return row[key] > value.gt;
      if ("gte" in value) return row[key] >= value.gte;
      if ("lt" in value) return row[key] < value.lt;
      if ("not" in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
}
function model(rows: () => any[]) {
  return {
    findUnique: jest.fn(async ({ where }: any) => rows().find(row => matches(row, where)) ?? null),
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      const found = rows().filter(row => matches(row, where));
      if (orderBy) found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return found[0] ?? null;
    }),
    count: jest.fn(async ({ where }: any) => rows().filter(row => matches(row, where)).length),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `${rows().length + 1}`, attempts: 0, consumedAt: null, revokedAt: null, createdAt: new Date(now), lastSentAt: new Date(now), ...data };
      rows().push(row); return row;
    }),
    update: jest.fn(async ({ where, data }: any) => { const row = rows().find(row => matches(row, where)); Object.assign(row, data); return row; }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const found = rows().filter(row => matches(row, where));
      for (const row of found) for (const [key, value] of Object.entries(data) as [string, any][]) row[key] = value?.increment ? row[key] + value.increment : value;
      return { count: found.length };
    }),
  };
}
const db: any = {
  organization: { findUnique: jest.fn(async () => ({ name: "Test Organization" })) },
  user: { findFirst: jest.fn(async ({ where }: any) => current.id === where.id && current.password === where.password ? { id: current.id } : null) },
  loginChallenge: model(() => challenges), trustedDevice: model(() => devices), refreshToken: model(() => sessions),
};
// Serial execution models the database's Serializable isolation and transaction retry boundary.
let queue: Promise<unknown> = Promise.resolve();
db.$transaction = (work: any) => {
  const result = queue.then(async () => {
    const before = structuredClone({ challenges, devices, sessions, audits });
    try { return await work(db); } catch (error) { ({ challenges, devices, sessions, audits } = before); throw error; }
  });
  queue = result.catch(() => {}); return result;
};
jest.unstable_mockModule("@/lib/prisma", () => ({ prisma: db }));
jest.unstable_mockModule("@/config/env", () => ({ env: {
  TWO_FACTOR_CODE_LENGTH: 4, TWO_FACTOR_CODE_TTL_SECONDS: 600, TWO_FACTOR_MAX_ATTEMPTS: 5,
  TWO_FACTOR_RESEND_SECONDS: 60, TWO_FACTOR_SEND_MAX_PER_HOUR: 5, TRUSTED_DEVICE_TENANT_DAYS: 30,
  TRUSTED_DEVICE_ADMIN_DAYS: 7, JWT_ACCESS_SECRET: "test-secret-at-least-thirty-two-characters", REFRESH_TOKEN_DAYS: 7,
} }));
jest.unstable_mockModule("@/modules/auth/authorization", () => ({
  loadAuthorization: jest.fn(async () => { if (current.status !== "ACTIVE") throw new Error("inactive"); return current; }),
  sessionUser: (user: any) => ({ ...user, permissions: [] }),
}));
jest.unstable_mockModule("@/modules/system-admin/platform-audit", () => ({ recordPlatformAudit: async (_db: unknown, event: any) => { audits.push(event); } }));
jest.unstable_mockModule("@/lib/email/send-login-code", () => ({ sendLoginCodeEmail: async (_to: string, _name: string, code: string) => {
  if (deliveryFails) throw new Error("provider failure"); sentCodes.push(code);
} }));
jest.unstable_mockModule("@/utils/tokens", () => ({
  generateAccessToken: () => "completed-access-token", generateRefreshTokenValue: () => "completed-refresh-token",
  hashToken: hash, getRefreshExpiry: () => new Date(now.getTime() + 600000),
}));
const { twoFactorService } = await import("@/modules/auth/two-factor.service");
const { env: configuration } = await import("@/config/env");
const hints = { userAgent: "Test Browser", ipAddress: "192.0.2.1", trustedTokens: {} };
const begin = () => twoFactorService.beginLogin({ id: current.id, password: current.password }, hints);

test("unknown and replaced resend handles cannot consume an account delivery budget", async () => {
  const budget = jest.fn(async (_userId: string) => {});
  await expect(twoFactorService.resend("unknown-handle", budget)).rejects.toMatchObject({ statusCode: 400 });
  expect(budget).not.toHaveBeenCalled();
});
beforeEach(() => {
  configuration.TWO_FACTOR_CODE_LENGTH = 4;
  now = new Date("2026-10-23T12:00:00Z"); jest.useFakeTimers({ now });
  current = { id: "user-a", organizationId: "org-a", platformRole: "NONE", sessionVersion: 0,
    email: "alex@example.invalid", firstName: "Alex", status: "ACTIVE", password: "password-hash", organization: { id: "org-a", slug: "org-a" } };
  challenges = []; devices = []; sessions = []; audits = []; sentCodes = []; deliveryFails = false;
});
afterEach(() => jest.useRealTimers());
async function issued() {
  const result = await begin();
  if (!("requiresTwoFactor" in result)) throw new Error("Expected challenge");
  return result;
}
test("valid password issues only an opaque challenge, with hashed code and no session", async () => {
  const result = await issued();
  expect(result).toMatchObject({ requiresTwoFactor: true, codeLength: 4, trustedDeviceDays: 30, deliveryStatus: "sent" });
  expect(sentCodes[0]).toMatch(/^\d{4}$/); expect(challenges[0].codeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(challenges[0].codeHash).not.toBe(sentCodes[0]);
  expect(challenges[0].challengeHash).toBe(hash(result.challengeId)); expect(sessions).toHaveLength(0);
  expect(result).not.toHaveProperty("code"); expect(result).not.toHaveProperty("codeHash");
});
test("verification creates the session and rejects code reuse", async () => {
  const challenge = await issued();
  expect(await twoFactorService.verify(challenge.challengeId, sentCodes[0], false, hints)).toMatchObject({ accessToken: "completed-access-token" });
  await expect(twoFactorService.verify(challenge.challengeId, sentCodes[0], false, hints)).rejects.toMatchObject({ statusCode: 400 });
  expect(sessions).toHaveLength(1);
});
test("code length can be changed to six without changing the login contract", async () => {
  configuration.TWO_FACTOR_CODE_LENGTH = 6;
  const challenge = await issued(); expect(challenge.codeLength).toBe(6); expect(sentCodes[0]).toMatch(/^\d{6}$/);
  expect(await twoFactorService.verify(challenge.challengeId, sentCodes[0], false, hints)).toHaveProperty("accessToken");
});
test("code expires at exactly ten minutes", async () => {
  const challenge = await issued(); jest.setSystemTime(now.getTime() + 600000);
  await expect(twoFactorService.verify(challenge.challengeId, sentCodes[0], false, hints)).rejects.toMatchObject({ statusCode: 400 });
  expect(sessions).toHaveLength(0);
});
test("five failures persist across errors and invalidate the code", async () => {
  const challenge = await issued(); const wrong = sentCodes[0] === "0000" ? "0001" : "0000";
  for (let i = 0; i < 5; i++) await expect(twoFactorService.verify(challenge.challengeId, wrong, false, hints)).rejects.toMatchObject({ statusCode: 400 });
  expect(challenges[0].attempts).toBe(5); expect(challenges[0].consumedAt).not.toBeNull();
  await expect(twoFactorService.verify(challenge.challengeId, sentCodes[0], false, hints)).rejects.toMatchObject({ statusCode: 400 });
  expect(sessions).toHaveLength(0);
});
test("resend cooldown and hourly account budget survive fresh password logins", async () => {
  let challenge = await issued();
  await expect(twoFactorService.resend(challenge.challengeId)).rejects.toMatchObject({ statusCode: 429, retryAfterSeconds: 60 });
  await expect(begin()).rejects.toMatchObject({ statusCode: 429 });
  for (let i = 1; i < 5; i++) { now = new Date(now.getTime() + 60000); jest.setSystemTime(now); challenge = await twoFactorService.resend(challenge.challengeId); }
  jest.setSystemTime(now.getTime() + 60000);
  await expect(twoFactorService.resend(challenge.challengeId)).rejects.toMatchObject({ statusCode: 429 });
  expect(sentCodes).toHaveLength(5);
});
test("resend invalidates previous code and stale handles cannot invalidate the replacement", async () => {
  const first = await issued(); jest.setSystemTime(now.getTime() + 60000);
  const second = await twoFactorService.resend(first.challengeId);
  await expect(twoFactorService.verify(first.challengeId, sentCodes[0], false, hints)).rejects.toMatchObject({ statusCode: 400 });
  await expect(twoFactorService.resend(first.challengeId)).rejects.toMatchObject({ statusCode: 400 });
  expect(await twoFactorService.verify(second.challengeId, sentCodes[1], false, hints)).toHaveProperty("accessToken");
});
test("locked code can request a replacement after the cooldown", async () => {
  const first = await issued(); const wrong = sentCodes[0] === "0000" ? "0001" : "0000";
  for (let i = 0; i < 5; i++) await twoFactorService.verify(first.challengeId, wrong, false, hints).catch(() => {});
  jest.setSystemTime(now.getTime() + 60000);
  const second = await twoFactorService.resend(first.challengeId);
  expect(await twoFactorService.verify(second.challengeId, sentCodes[1], false, hints)).toHaveProperty("accessToken");
});
test("delivery failure returns a recoverable challenge, with no session and no valid code", async () => {
  deliveryFails = true; const result = await issued(); expect(result.deliveryStatus).toBe("failed"); expect(sessions).toHaveLength(0);
  deliveryFails = false; jest.setSystemTime(now.getTime() + 60000);
  const replacement = await twoFactorService.resend(result.challengeId); expect(replacement.deliveryStatus).toBe("sent");
});
test("remember device stores only a hash and skips the next challenge", async () => {
  const challenge = await issued();
  const result = await twoFactorService.verify(challenge.challengeId, sentCodes[0], true, hints);
  expect(result.trustedDevice).toMatchObject({ surface: "tenant", days: 30 });
  expect(devices[0].tokenHash).toBe(hash(result.trustedDevice!.token));
  expect(await twoFactorService.beginLogin({ id: current.id, password: current.password }, { ...hints, trustedTokens: { tenant: result.trustedDevice!.token } })).toHaveProperty("accessToken");
  expect(sentCodes).toHaveLength(1);
});
test.each(["revoked", "expired", "surface", "organization", "agent", "user"])("%s trusted device does not skip 2FA", async (kind) => {
  const challenge = await issued(); const verified = await twoFactorService.verify(challenge.challengeId, sentCodes[0], true, hints);
  if (kind === "revoked") devices[0].revokedAt = new Date(now);
  if (kind === "expired") devices[0].expiresAt = new Date(now);
  if (kind === "surface") devices[0].surface = "system-admin";
  if (kind === "organization") devices[0].organizationId = "other";
  if (kind === "agent") devices[0].userAgent = "Other Browser";
  if (kind === "user") devices[0].userId = "other-user";
  now = new Date(now.getTime() + 60000); jest.setSystemTime(now);
  expect(await twoFactorService.beginLogin({ id: current.id, password: current.password }, { ...hints, trustedTokens: { tenant: verified.trustedDevice!.token } })).toHaveProperty("requiresTwoFactor", true);
});
test("system admin trust uses seven days and the admin cookie surface", async () => {
  current.organizationId = null; current.platformRole = "SYSTEM_ADMIN"; current.organization = null;
  const challenge = await issued(); expect(challenge.trustedDeviceDays).toBe(7);
  const result = await twoFactorService.verify(challenge.challengeId, sentCodes[0], true, hints);
  expect(result.trustedDevice).toMatchObject({ surface: "system-admin", days: 7 });
});
test("credential version changes invalidate pending challenges", async () => {
  const challenge = await issued(); current.sessionVersion++;
  await expect(twoFactorService.verify(challenge.challengeId, sentCodes[0], false, hints)).rejects.toMatchObject({ statusCode: 400 });
});
test("parallel verification consumes a code only once", async () => {
  const challenge = await issued();
  const results = await Promise.allSettled([1, 2].map(() => twoFactorService.verify(challenge.challengeId, sentCodes[0], false, hints)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(sessions).toHaveLength(1);
});
