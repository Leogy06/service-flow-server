import { jest } from "@jest/globals";

// Repository transactions are serialized here to exercise idempotent business behavior.
// Real lock/unique-constraint races are covered by the opt-in MySQL harness.
type Row = Record<string, any>;
let state: { plans: Row[]; subscriptions: Row[]; payments: Row[]; refunds: Row[]; history: Row[]; organizations: Row[]; users: Row[]; audits: Row[] };
let failAudit = false;
let queue = Promise.resolve();
const normalize = (value: any): any => {
  if (value === null || value === undefined) return value;
  if (typeof value === "object" && typeof value.getTime === "function" && typeof value.toISOString === "function") return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object" && typeof value.toFixed === "function") return value.toFixed(2);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
};
const match = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => {
  if (value === undefined) return true;
  if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
  if (value && typeof value === "object" && "gt" in value) return row[key] > value.gt;
  if (value && typeof value === "object" && "gte" in value) return row[key] >= value.gte;
  return row[key] === value;
});
function decorate(name: keyof typeof state, row: Row | undefined) {
  if (!row) return null;
  const result = structuredClone(row);
  if (name === "subscriptions") {
    result.plan = structuredClone(state.plans.find((plan) => plan.id === row.planId));
    result.organization = structuredClone(state.organizations.find((org) => org.id === row.organizationId));
  }
  if (name === "payments") result.subscription = decorate("subscriptions", state.subscriptions.find((sub) => sub.id === row.subscriptionId));
  return result;
}
function delegate(name: keyof typeof state) {
  return {
    findUnique: jest.fn(async ({ where }: Row) => decorate(name, state[name].find((row) => match(row, where)))),
    findFirst: jest.fn(async ({ where }: Row) => decorate(name, state[name].find((row) => match(row, where)))),
    findMany: jest.fn(async ({ where = {} }: Row = {}) => state[name].filter((row) => match(row, where)).map((row) => decorate(name, row))),
    count: jest.fn(async ({ where = {} }: Row = {}) => state[name].filter((row) => match(row, where)).length),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: `${name}-${state[name].length + 1}`, version: 0, ...normalize(data) };
      state[name].push(row); return decorate(name, row);
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = state[name].find((item) => match(item, where));
      if (!row) throw new Error("Missing fixture");
      Object.entries(normalize(data)).forEach(([key, value]) => { row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value; });
      return decorate(name, row);
    }),
  };
}
const db = {
  plan: delegate("plans"), subscription: delegate("subscriptions"), subscriptionPayment: delegate("payments"),
  subscriptionRefund: delegate("refunds"), subscriptionHistory: delegate("history"), organization: delegate("organizations"),
  user: delegate("users"), platformSettings: { findUnique: jest.fn(async () => ({ gracePeriodDays: 0 })) },
  $queryRaw: jest.fn(async () => []),
};
async function transaction<T>(work: (client: typeof db) => Promise<T>): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const before = structuredClone(state);
  try { return await work(db); } catch (error) { state = before; throw error; } finally { release(); }
}
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/modules/role/tenant-access-policy.js", () => ({ requirePlatformAuthority: jest.fn(async () => ({ id: "platform-actor" })) }));
jest.unstable_mockModule("@/modules/system-admin/platform-audit.js", () => ({
  platformTransaction: transaction, lockOrganization: jest.fn(async () => {}),
  recordPlatformAudit: jest.fn(async (_db: unknown, event: Row) => {
    if (failAudit) throw new Error("Audit unavailable");
    state.audits.push(normalize(event));
  }),
}));
const { billingService } = await import("@/modules/system-admin/billing.service.js");
const { enforceSeatLimit } = await import("@/modules/system-admin/entitlement.js");
const { Prisma } = await import("@/generated/prisma/client.js");
const tx = db as unknown as import("@/generated/prisma/client.js").Prisma.TransactionClient;
const reason = { reason: "Verified bank evidence", confirm: true as const };
const paymentInput = { ...reason, subscriptionId: "sub-a", amount: "2999.00", currency: "PHP", paymentMethod: "BANK_TRANSFER" as const,
  referenceNumber: "BANK-2026-A", idempotencyKey: "payment-key-a", paidAt: new Date(Date.now() - 1000) };
const reviewInput = { ...reason, decision: "PAID" as const, evidence: "bank-statement:2026-10-15:A" };
beforeEach(() => {
  jest.clearAllMocks(); failAudit = false; queue = Promise.resolve();
  state = { plans: [{ id: "plan-a", name: "Starter", annualPrice: "2999.00", currency: "PHP", maxActiveUsers: 3, isActive: true },
    { id: "plan-b", name: "Growth", annualPrice: "5999.00", currency: "PHP", maxActiveUsers: 10, isActive: true }],
    subscriptions: [{ id: "sub-a", organizationId: "org-a", planId: "plan-a", status: "PENDING", annualPrice: "2999.00", currency: "PHP",
      startsAt: null, expiresAt: null, currentPeriodPaymentId: null, version: 0 }],
    organizations: [{ id: "org-a", billingEnabled: true, status: "ACTIVE" }],
    users: [{ id: "owner-a", organizationId: "org-a", status: "ACTIVE", platformRole: "NONE", securityStatus: "ACTIVE", deletedAt: null }],
    payments: [], refunds: [], history: [], audits: [] };
});

test("verification activates one exact annual period with immutable history and audit", async () => {
  const payment = await billingService.recordPayment(paymentInput);
  expect(payment.status).toBe("PENDING");
  const result = await billingService.reviewPayment(payment.id, reviewInput);
  expect(result.status).toBe("PAID");
  expect(state.subscriptions[0]).toMatchObject({ status: "ACTIVE", currentPeriodPaymentId: payment.id, annualPrice: "2999.00" });
  expect(state.history).toHaveLength(1);
  expect(state.history[0].before.status).toBe("PENDING");
  expect(state.history[0].after.status).toBe("ACTIVE");
  expect(state.audits.map((event) => event.action)).toContain("platform.payment.verify");
});

test("repeated and competing verification of the same payment cannot renew twice", async () => {
  const payment = await billingService.recordPayment(paymentInput);
  await Promise.all([billingService.reviewPayment(payment.id, reviewInput), billingService.reviewPayment(payment.id, reviewInput)]);
  const expiration = state.subscriptions[0].expiresAt;
  await billingService.reviewPayment(payment.id, reviewInput);
  expect(state.subscriptions[0].expiresAt).toEqual(expiration);
  expect(state.history).toHaveLength(1);
});

test.each(["2998.99", "2999.01"])("verification rejects nonexact annual amount %s", async (amount) => {
  const payment = await billingService.recordPayment({ ...paymentInput, amount });
  await expect(billingService.reviewPayment(payment.id, reviewInput)).rejects.toMatchObject({ statusCode: 409 });
  expect(state.subscriptions[0].status).toBe("PENDING");
  expect(state.payments[0].status).toBe("PENDING");
});

test("payment idempotency is reused only for the same immutable request", async () => {
  const first = await billingService.recordPayment(paymentInput);
  expect((await billingService.recordPayment(paymentInput)).id).toBe(first.id);
  await expect(billingService.recordPayment({ ...paymentInput, amount: "1.00" })).rejects.toMatchObject({ statusCode: 409 });
  expect(state.payments).toHaveLength(1);
});

test("idempotency keys cannot be replayed against another subscription or refund target", async () => {
  const first = await billingService.recordPayment(paymentInput);
  state.subscriptions.push({ ...state.subscriptions[0], id: "sub-b", organizationId: "org-b" });
  state.organizations.push({ id: "org-b", billingEnabled: true, status: "ACTIVE" });
  await expect(billingService.recordPayment({ ...paymentInput, subscriptionId: "sub-b" })).rejects.toMatchObject({ statusCode: 409 });
  await billingService.reviewPayment(first.id, reviewInput);
  const second = await billingService.recordPayment({ ...paymentInput, referenceNumber: "BANK-SECOND", idempotencyKey: "second-key" });
  await billingService.reviewPayment(second.id, reviewInput);
  const refund = { ...reason, evidence: "refund-target-review", idempotencyKey: "shared-refund-key" };
  await billingService.refundPayment(first.id, refund);
  await expect(billingService.refundPayment(second.id, refund)).rejects.toMatchObject({ statusCode: 409 });
  expect(state.payments[1].status).toBe("PAID");
  expect(state.refunds).toHaveLength(1);
});

test("manual activation is forbidden and rejected payments cannot be approved", async () => {
  await expect(billingService.changeStatus("sub-a", { ...reason, status: "ACTIVE" as any })).rejects.toThrow();
  const payment = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(payment.id, { ...reviewInput, decision: "REJECTED" });
  await expect(billingService.reviewPayment(payment.id, reviewInput)).rejects.toMatchObject({ statusCode: 409 });
});

test("plan changes preserve current period price and use the new price only on renewal", async () => {
  const first = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(first.id, reviewInput);
  await billingService.changePlan("sub-a", { ...reason, planId: "plan-b" });
  expect(state.subscriptions[0].annualPrice).toBe("2999.00");
  expect(state.payments[0].amount).toBe("2999.00");
  const second = await billingService.recordPayment({ ...paymentInput, amount: "5999.00", referenceNumber: "BANK-2026-B", idempotencyKey: "payment-key-b" });
  await billingService.reviewPayment(second.id, reviewInput);
  expect(state.subscriptions[0].annualPrice).toBe("5999.00");
  expect(state.payments[0].amount).toBe("2999.00");
});

test("downgrades and seat activation include the owner and blocked active accounts", async () => {
  state.users.push(...["blocked", "staff", "extra"].map((id) => ({ id, organizationId: "org-a", status: "ACTIVE", platformRole: "NONE", securityStatus: "BLOCKED", deletedAt: null })));
  state.subscriptions[0].planId = "plan-b";
  await expect(billingService.changePlan("sub-a", { ...reason, planId: "plan-a" })).rejects.toMatchObject({ statusCode: 409 });
  state.subscriptions[0].planId = "plan-a";
  await expect(enforceSeatLimit(tx, "org-a")).rejects.toMatchObject({ statusCode: 409 });
});

test("pending invites, deleted users and platform identities do not consume seats", async () => {
  state.users.push({ id: "invite", organizationId: "org-a", status: "PENDING", platformRole: "NONE", deletedAt: null },
    { id: "deleted", organizationId: "org-a", status: "ACTIVE", platformRole: "NONE", deletedAt: new Date() },
    { id: "operator", organizationId: "org-a", status: "ACTIVE", platformRole: "SYSTEM_ADMIN", deletedAt: null });
  await expect(enforceSeatLimit(tx, "org-a", 2)).resolves.toBeUndefined();
});

test("audit failure rolls back payment verification and renewal", async () => {
  const payment = await billingService.recordPayment(paymentInput);
  failAudit = true;
  await expect(billingService.reviewPayment(payment.id, reviewInput)).rejects.toThrow("Audit unavailable");
  expect(state.subscriptions[0].status).toBe("PENDING");
  expect(state.payments[0].status).toBe("PENDING");
  expect(state.history).toHaveLength(0);
});

test("full refunds are separate, idempotent records and revoke current entitlement", async () => {
  const payment = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(payment.id, reviewInput);
  const input = { ...reason, evidence: "bank-refund:confirmation:A", idempotencyKey: "refund-key-a" };
  const refund = await billingService.refundPayment(payment.id, input);
  expect(new Prisma.Decimal(refund.amount).toFixed(2)).toBe("2999.00");
  expect(state.payments[0].status).toBe("REFUNDED");
  expect(state.subscriptions[0].status).toBe("CANCELED");
  expect((await billingService.refundPayment(payment.id, input)).id).toBe(refund.id);
  expect(state.refunds).toHaveLength(1);
});

test("initial assignment atomically enrolls billing and prevents overlapping subscriptions", async () => {
  state.subscriptions = []; state.organizations[0].billingEnabled = false;
  const assigned = await billingService.assignSubscription({ ...reason, organizationId: "org-a", planId: "plan-a" });
  expect(assigned.status).toBe("PENDING");
  expect(state.organizations[0].billingEnabled).toBe(true);
  await expect(billingService.assignSubscription({ ...reason, organizationId: "org-a", planId: "plan-b" })).rejects.toMatchObject({ statusCode: 409 });
  expect(state.subscriptions).toHaveLength(1);
});

test("refunding a future renewal restores the still-paid previous period", async () => {
  const first = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(first.id, reviewInput);
  const previousExpiry = state.subscriptions[0].expiresAt;
  const second = await billingService.recordPayment({ ...paymentInput, referenceNumber: "BANK-FUTURE", idempotencyKey: "future-key" });
  await billingService.reviewPayment(second.id, reviewInput);
  await billingService.refundPayment(second.id, { ...reason, evidence: "future-renewal-refund", idempotencyKey: "future-refund-key" });
  expect(state.subscriptions[0]).toMatchObject({ status: "ACTIVE", currentPeriodPaymentId: first.id, expiresAt: previousExpiry });
});

test("historic refunds preserve the present period and refunded history cannot be restored", async () => {
  const first = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(first.id, reviewInput);
  const second = await billingService.recordPayment({ ...paymentInput, referenceNumber: "BANK-FUTURE", idempotencyKey: "future-key" });
  await billingService.reviewPayment(second.id, reviewInput);
  // Advance the fixture's paid intervals so the first is a genuinely ended period.
  state.payments[0].periodStartsAt = new Date(Date.now() - 731 * 86_400_000);
  state.payments[0].periodExpiresAt = new Date(Date.now() - 366 * 86_400_000);
  state.payments[1].periodStartsAt = new Date(Date.now() - 86_400_000);
  state.payments[1].periodExpiresAt = new Date(Date.now() + 364 * 86_400_000);
  state.subscriptions[0].startsAt = state.payments[1].periodStartsAt;
  state.subscriptions[0].expiresAt = state.payments[1].periodExpiresAt;
  const currentExpiry = state.subscriptions[0].expiresAt;
  await billingService.refundPayment(first.id, { ...reason, evidence: "historic-refund-review", idempotencyKey: "historic-refund-key" });
  expect(state.subscriptions[0]).toMatchObject({ status: "ACTIVE", currentPeriodPaymentId: second.id, expiresAt: currentExpiry });
  await billingService.refundPayment(second.id, { ...reason, evidence: "future-renewal-refund", idempotencyKey: "future-refund-key" });
  expect(state.subscriptions[0].status).toBe("CANCELED");
});

test("refunding current coverage cannot grant access during a gap before a future renewal", async () => {
  const first = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(first.id, reviewInput);
  const second = await billingService.recordPayment({ ...paymentInput, referenceNumber: "BANK-FUTURE", idempotencyKey: "future-key" });
  await billingService.reviewPayment(second.id, reviewInput);
  await billingService.refundPayment(first.id, { ...reason, evidence: "current-period-refund", idempotencyKey: "current-refund-key" });
  expect(new Date(state.subscriptions[0].startsAt).getTime()).toBeGreaterThan(Date.now());
  expect(state.subscriptions[0].currentPeriodPaymentId).toBe(second.id);
  const third = await billingService.recordPayment({ ...paymentInput, referenceNumber: "BANK-GAP", idempotencyKey: "gap-key-a" });
  await expect(billingService.reviewPayment(third.id, reviewInput)).rejects.toMatchObject({ statusCode: 409 });
});

test("renewing a canceled future entitlement starts a fresh annual period", async () => {
  const first = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(first.id, reviewInput);
  const oldExpiration = state.subscriptions[0].expiresAt;
  await billingService.changeStatus("sub-a", { ...reason, status: "CANCELED" });
  const second = await billingService.recordPayment({ ...paymentInput, referenceNumber: "BANK-RESTART", idempotencyKey: "restart-key" });
  await billingService.reviewPayment(second.id, reviewInput);
  expect(state.subscriptions[0].startsAt).toEqual(state.payments[1].periodStartsAt);
  expect(state.payments[1].periodStartsAt.getTime()).toBeLessThan(oldExpiration.getTime());
  expect(state.subscriptions[0].expiresAt.getTime()).toBeLessThan(oldExpiration.getTime() + 86_400_000);
  await billingService.refundPayment(second.id, { ...reason, evidence: "restart-period-refund", idempotencyKey: "restart-refund-key" });
  expect(state.payments[0].status).toBe("PAID");
  expect(state.subscriptions[0].status).toBe("CANCELED");
});
