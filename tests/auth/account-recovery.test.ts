import { jest } from "@jest/globals";
import type { Prisma } from "../../src/generated/prisma/client.js";

type Row = Record<string, unknown>;
type Query = { where: Row; data: Row };
let users: Row[], sessions: Row[], devices: Row[], challenges: Row[], audits: Row[];
let failAudit = false;
const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);
const updateMany = (rows: () => Row[]) => jest.fn(async ({ where, data }: Query) => {
  const found = rows().filter((row) => matches(row, where));
  for (const row of found) {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
    }
  }
  return { count: found.length };
});
const db = {
  user: {
    findUnique: jest.fn(async ({ where }: { where: Row }) => users.find((row) => matches(row, where)) ?? null),
    updateMany: updateMany(() => users),
  },
  refreshToken: { deleteMany: jest.fn(async ({ where }: { where: Row }) => {
    const before = sessions.length; sessions = sessions.filter((row) => !matches(row, where)); return { count: before - sessions.length };
  }) },
  trustedDevice: { updateMany: updateMany(() => devices) },
  loginChallenge: { updateMany: updateMany(() => challenges) },
  auditLog: { create: jest.fn(async ({ data }: { data: Row }) => {
    if (failAudit) throw new Error("Audit unavailable"); audits.push(data); return data;
  }) },
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, invalidateCache: jest.fn(async () => {}), getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load() }));
const { accountRecoverySchema, parseAccountRecoveryArguments, recoverAccountEmailInTransaction } = await import("@/modules/auth/account-recovery.js");
const input = { email: "old@example.invalid", newEmail: "recovered@example.invalid", reason: "Identity verified with the account owner out of band", identityVerified: true as const };
const args = [`--email=${input.email}`, `--new-email=${input.newEmail}`, `--reason=${input.reason}`, "--identity-verified"];
async function recover(apply = false) {
  const saved = structuredClone({ users, sessions, devices, challenges, audits });
  try { return await recoverAccountEmailInTransaction(db as unknown as Prisma.TransactionClient, input, { apply }); }
  catch (error) { ({ users, sessions, devices, challenges, audits } = saved); throw error; }
}
beforeEach(() => {
  jest.clearAllMocks(); failAudit = false; audits = [];
  users = [
    { id: "owner", email: input.email, organizationId: "org-a", platformRole: "NONE", status: "ACTIVE", securityStatus: "ACTIVE", deletedAt: null, sessionVersion: 2, password: "existing-password-hash", inviteToken: "old-invite", inviteTokenExpiry: new Date() },
    { id: "foreign", email: "other@example.invalid", organizationId: "org-b", platformRole: "NONE", status: "ACTIVE", securityStatus: "ACTIVE", deletedAt: null, sessionVersion: 0 },
  ];
  sessions = [{ userId: "owner", organizationId: "org-a" }, { userId: "foreign", organizationId: "org-b" }];
  devices = ["tenant", "system-admin"].map((surface) => ({ userId: "owner", organizationId: "org-a", surface, revokedAt: null }));
  devices.push({ userId: "foreign", organizationId: "org-b", surface: "tenant", revokedAt: null });
  challenges = [{ userId: "owner", organizationId: "org-a", consumedAt: null }, { userId: "foreign", organizationId: "org-b", consumedAt: null }];
});

test("recovery CLI defaults to dry run and requires explicit identity verification", () => {
  expect(parseAccountRecoveryArguments(args)).toEqual({ input, apply: false });
  expect(parseAccountRecoveryArguments([...args, "--apply"])).toEqual({ input, apply: true });
  expect(() => parseAccountRecoveryArguments(args.slice(0, -1))).toThrow();
  expect(() => parseAccountRecoveryArguments([...args, "--disable-2fa"])).toThrow();
  expect(() => parseAccountRecoveryArguments([...args, "--email=changed@example.invalid"])).toThrow();
});

test.each([
  { email: "bad" }, { newEmail: "bad" }, { newEmail: input.email }, { reason: "" }, { identityVerified: false }, { userId: "foreign" },
])("rejects invalid or unverified recovery inputs %j", (change) => {
  expect(accountRecoverySchema.safeParse({ ...input, ...change }).success).toBe(false);
});

test("dry run validates the proposed identity and changes no records", async () => {
  const saved = structuredClone({ users, sessions, devices, challenges, audits });
  expect(await recover()).toEqual({ status: "would-recover", userId: "owner" });
  expect({ users, sessions, devices, challenges, audits }).toEqual(saved);
  expect(db.user.updateMany).not.toHaveBeenCalled();
  expect(db.trustedDevice.updateMany).not.toHaveBeenCalled();
});

test("apply changes only the email, invalidates sessions and all factors, and preserves password and account authority", async () => {
  expect(await recover(true)).toEqual({ status: "recovered", userId: "owner" });
  expect(users[0]).toMatchObject({ email: input.newEmail, password: "existing-password-hash", organizationId: "org-a", platformRole: "NONE", status: "ACTIVE", securityStatus: "ACTIVE", sessionVersion: 3, inviteToken: null, inviteTokenExpiry: null });
  expect(sessions).toEqual([{ userId: "foreign", organizationId: "org-b" }]);
  expect(devices.slice(0, 2).every((row) => row.revokedAt instanceof Date)).toBe(true);
  expect(devices[2]!.revokedAt).toBeNull();
  expect(challenges[0]!.consumedAt).toBeInstanceOf(Date);
  expect(challenges[1]!.consumedAt).toBeNull();
  expect(audits[0]).toMatchObject({ scope: "PLATFORM", actorType: "OPERATOR", actorId: null, action: "auth.2fa.account.recovered", entityId: "owner", organizationId: "org-a", metadata: { after: { identityVerified: true, reason: input.reason, devicesRevoked: 2, challengesConsumed: 1, sessionsRevoked: 1 } } });
  expect(JSON.stringify(audits)).not.toContain("existing-password-hash");
});

test("platform recovery preserves explicit platform authority and requires the normal next login", async () => {
  Object.assign(users[0]!, { organizationId: null, platformRole: "SYSTEM_ADMIN" });
  expect(await recover(true)).toMatchObject({ status: "recovered" });
  expect(users[0]).toMatchObject({ organizationId: null, platformRole: "SYSTEM_ADMIN", password: "existing-password-hash" });
});

test.each(["missing", "deleted", "pending", "blocked", "email-in-use"])("refuses unavailable recovery target: %s", async (condition) => {
  if (condition === "missing") users.shift();
  if (condition === "deleted") users[0]!.deletedAt = new Date();
  if (condition === "pending") users[0]!.status = "PENDING";
  if (condition === "blocked") users[0]!.securityStatus = "BLOCKED";
  if (condition === "email-in-use") users[1]!.email = input.newEmail;
  await expect(recover(true)).rejects.toMatchObject({ statusCode: 409 });
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

test("an audit append failure rolls back the entire recovery", async () => {
  const saved = structuredClone({ users, sessions, devices, challenges, audits }); failAudit = true;
  await expect(recover(true)).rejects.toThrow("Audit unavailable");
  expect({ users, sessions, devices, challenges, audits }).toEqual(saved);
});
