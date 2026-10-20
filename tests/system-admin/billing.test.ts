import { jest } from "@jest/globals";

jest.unstable_mockModule("@/utils/cache.js", () => ({ DEFAULT_TTL_SECONDS: 60, getOrSetCache: async (_key: string, _ttl: number, load: () => Promise<unknown>) => load(), invalidateCache: jest.fn(async () => {}) }));

// Repository transactions are serialized here to exercise idempotent business behavior.
// Real lock/unique-constraint races are covered by the opt-in MySQL harness.
type Row = Record<string, any>;
let state: { plans: Row[]; subscriptions: Row[]; payments: Row[]; refunds: Row[]; refundRequests: Row[]; history: Row[]; organizations: Row[]; users: Row[]; audits: Row[] };
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
  subscriptionRefundRequest: delegate("refundRequests"),
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
const { requirePlatformAuthority } = await import("@/modules/role/tenant-access-policy.js");
const { enforceSeatLimit, assertTenantEntitlement } = await import("@/modules/system-admin/entitlement.js");
const { Prisma } = await import("@/generated/prisma/client.js");
const tx = db as unknown as import("@/generated/prisma/client.js").Prisma.TransactionClient;
const reason = { reason: "Verified bank evidence", confirm: true as const };
const paymentInput = { ...reason, subscriptionId: "sub-a", amount: "2999.00", currency: "PHP", paymentMethod: "BANK_TRANSFER" as const,
  referenceNumber: "BANK-2026-A", idempotencyKey: "payment-key-a", paidAt: new Date(Date.now() - 1000) };
const reviewInput = { ...reason, decision: "PAID" as const, evidence: "bank-statement:2026-10-15:A" };
async function approvedRefundRequest(paymentId: string) {
  const request = await billingService.requestRefund(paymentId, { ...reason, evidence: "customer-request-reference", idempotencyKey: `request-${paymentId}` });
  await billingService.reviewRefund(paymentId, { ...reason, requestId: request.id, decision: "APPROVED" });
  return request.id;
}
beforeEach(() => {
  jest.clearAllMocks(); failAudit = false; queue = Promise.resolve();
  state = { plans: [{ id: "plan-a", name: "Starter", price: "2999.00", billingInterval: "YEARLY", currency: "PHP", maxActiveUsers: 3, isActive: true },
    { id: "plan-b", name: "Growth", price: "5999.00", billingInterval: "YEARLY", currency: "PHP", maxActiveUsers: 10, isActive: true }],
    subscriptions: [{ id: "sub-a", organizationId: "org-a", planId: "plan-a", status: "PENDING", price: "2999.00", billingInterval: "YEARLY", currency: "PHP",
      startsAt: null, expiresAt: null, currentPeriodPaymentId: null, version: 0 }],
    organizations: [{ id: "org-a", billingEnabled: true, status: "ACTIVE" }],
    users: [{ id: "owner-a", organizationId: "org-a", status: "ACTIVE", platformRole: "NONE", securityStatus: "ACTIVE", deletedAt: null }],
    payments: [], refunds: [], refundRequests: [], history: [], audits: [] };
});

test("review count includes pending subscriptions or requested upgrades in one distinct subscription count", async () => {
  db.subscription.count.mockResolvedValueOnce(7);
  expect(await billingService.countSubscriptionReviews()).toEqual({ needsReview: 7 });
  expect(requirePlatformAuthority).toHaveBeenCalledTimes(1);
  expect(db.subscription.count).toHaveBeenCalledWith({ where: { OR: [
    { status: "PENDING" }, { upgradeRequests: { some: { status: "REQUESTED" } } },
  ] } });
  expect(db.subscription.findMany).not.toHaveBeenCalled();
});

test("review count returns zero and propagates database failures", async () => {
  db.subscription.count.mockResolvedValueOnce(0);
  expect(await billingService.countSubscriptionReviews()).toEqual({ needsReview: 0 });
  db.subscription.count.mockRejectedValueOnce(new Error("Database unavailable"));
  await expect(billingService.countSubscriptionReviews()).rejects.toThrow("Database unavailable");
});

test("review count requires platform authority before any database count", async () => {
  jest.mocked(requirePlatformAuthority).mockRejectedValueOnce(new Error("Platform administration is required"));
  await expect(billingService.countSubscriptionReviews()).rejects.toThrow("Platform administration is required");
  expect(db.subscription.count).not.toHaveBeenCalled();
});

test("initial trial enrollment grants 14 days, enables billing, audits and creates no financial records", async () => {
  state.subscriptions = [];
  state.organizations[0].billingEnabled = false;
  const subscription = await billingService.assignSubscription({ ...reason, organizationId: "org-a", planId: "plan-a", startTrial: true });
  expect(subscription.status).toBe("TRIALING");
  expect(+subscription.expiresAt! - +subscription.startsAt!).toBe(14 * 86400000);
  expect(subscription.trialStartedAt).toEqual(subscription.startsAt);
  expect(subscription.trialExpiresAt).toEqual(subscription.expiresAt);
  expect(state.organizations[0].billingEnabled).toBe(true);
  expect(state.payments).toHaveLength(0);
  expect(state.refunds).toHaveLength(0);
  expect(state.history[0].kind).toBe("TRIAL_STARTED");
  expect(state.audits[0].action).toBe("platform.subscription.trial");
  await expect(assertTenantEntitlement(tx, "org-a")).resolves.toBeUndefined();
});

test("concurrent trial starts grant only one trial and never extend it", async () => {
  const result = await Promise.allSettled([billingService.startTrial("sub-a", reason), billingService.startTrial("sub-a", reason)]);
  expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  expect(result.find((item) => item.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
  const expiresAt = state.subscriptions[0].expiresAt;
  await expect(billingService.startTrial("sub-a", reason)).rejects.toMatchObject({ statusCode: 409 });
  expect(state.subscriptions[0].expiresAt).toEqual(expiresAt);
  expect(state.history).toHaveLength(1);
});

test.each(["ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED"])("trial start rejects %s subscriptions", async (status) => {
  state.subscriptions[0].status = status;
  await expect(billingService.startTrial("sub-a", reason)).rejects.toMatchObject({ statusCode: 409 });
  expect(state.history).toHaveLength(0);
});

test("expired trial loses access without running the scheduler or using grace", async () => {
  await billingService.startTrial("sub-a", reason);
  state.subscriptions[0].trialExpiresAt = new Date(Date.now() - 1000);
  state.subscriptions[0].expiresAt = state.subscriptions[0].trialExpiresAt;
  await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403 });
  await expect(billingService.startTrial("sub-a", reason)).rejects.toMatchObject({ statusCode: 409 });
  await expect(billingService.changeStatus("sub-a", { ...reason, status: "PAST_DUE" })).rejects.toMatchObject({ statusCode: 409 });
});

test("trial start enforces seats, available plans and transactional audit", async () => {
  state.users.push(...["staff", "blocked", "extra"].map((id) => ({ id, organizationId: "org-a", status: "ACTIVE", platformRole: "NONE", securityStatus: "BLOCKED", deletedAt: null })));
  await expect(billingService.startTrial("sub-a", reason)).rejects.toMatchObject({ statusCode: 409 });
  state.users.splice(1);
  state.plans[0].isActive = false;
  await expect(billingService.startTrial("sub-a", reason)).rejects.toMatchObject({ statusCode: 409 });
  state.plans[0].isActive = true;
  failAudit = true;
  await expect(billingService.startTrial("sub-a", reason)).rejects.toThrow("Audit unavailable");
  expect(state.subscriptions[0].status).toBe("PENDING");
  expect(state.subscriptions[0].trialStartedAt).toBeUndefined();
  expect(state.history).toHaveLength(0);
});

test("changing plans preserves the trial deadline and selected plan seat limits", async () => {
  await billingService.startTrial("sub-a", reason);
  const expiresAt = state.subscriptions[0].expiresAt;
  await billingService.changePlan("sub-a", { ...reason, planId: "plan-b" });
  expect(state.subscriptions[0]).toMatchObject({ status: "TRIALING", expiresAt, trialExpiresAt: expiresAt });
});

test("verified payment converts a trial immediately and refund never grants another trial", async () => {
  await billingService.startTrial("sub-a", reason);
  const trialStartedAt = state.subscriptions[0].trialStartedAt;
  const trialExpiresAt = state.subscriptions[0].trialExpiresAt;
  await expect(billingService.recordPayment({ ...paymentInput, amount: "1.00" })).rejects.toMatchObject({ statusCode: 409 });
  expect(state.payments).toHaveLength(0);
  expect(state.subscriptions[0].status).toBe("TRIALING");
  const paid = await billingService.recordPayment({ ...paymentInput, referenceNumber: "TRIAL-PAID", idempotencyKey: "trial-paid-key" });
  await billingService.reviewPayment(paid.id, reviewInput);
  const { billingPeriod } = await import("@/modules/system-admin/billing-policy.js");
  expect(state.subscriptions[0]).toMatchObject({ status: "ACTIVE", startsAt: state.payments[0].verifiedAt, trialStartedAt, trialExpiresAt });
  expect(state.subscriptions[0].expiresAt).toEqual(billingPeriod(state.payments[0].verifiedAt, null, "YEARLY").expiresAt);
  await billingService.refundPayment(paid.id, { ...reason, requestId: await approvedRefundRequest(paid.id), evidence: "confirmed-conversion-refund", idempotencyKey: "trial-refund-key" });
  expect(state.subscriptions[0]).toMatchObject({ status: "CANCELED", trialStartedAt, trialExpiresAt });
  await expect(billingService.startTrial("sub-a", reason)).rejects.toMatchObject({ statusCode: 409 });
  await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403 });
});

test("verification activates one exact annual period with immutable history and audit", async () => {
  const payment = await billingService.recordPayment(paymentInput);
  expect(payment.status).toBe("PENDING");
  const result = await billingService.reviewPayment(payment.id, reviewInput);
  expect(result.status).toBe("PAID");
  expect(state.subscriptions[0]).toMatchObject({ status: "ACTIVE", currentPeriodPaymentId: payment.id, price: "2999.00" });
  expect(state.history).toHaveLength(1);
  expect(state.history[0].before.status).toBe("PENDING");
  expect(state.history[0].after.status).toBe("ACTIVE");
  expect(state.audits.map((event) => event.action)).toContain("platform.payment.verify");
});

test("monthly verification snapshots its interval and repeated verification cannot renew twice", async () => {
  state.plans[0].billingInterval = "MONTHLY";
  state.plans[0].price = "299.00";
  const payment = await billingService.recordPayment({ ...paymentInput, amount: "299.00" });
  await billingService.reviewPayment(payment.id, reviewInput);
  const firstExpiration = state.subscriptions[0].expiresAt;
  const { billingPeriod } = await import("@/modules/system-admin/billing-policy.js");
  expect(firstExpiration).toEqual(billingPeriod(state.payments[0].verifiedAt, null, "MONTHLY").expiresAt);
  expect(state.subscriptions[0]).toMatchObject({ billingInterval: "MONTHLY", price: "299.00" });
  expect(state.payments[0].billingInterval).toBe("MONTHLY");
  await billingService.reviewPayment(payment.id, reviewInput);
  expect(state.subscriptions[0].expiresAt).toEqual(firstExpiration);
  expect(state.history).toHaveLength(1);
});

test("switching yearly to monthly preserves coverage until the next verified renewal", async () => {
  const yearlyPayment = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(yearlyPayment.id, reviewInput);
  const yearlyExpiration = state.subscriptions[0].expiresAt;
  state.plans[1].billingInterval = "MONTHLY";
  state.plans[1].price = "599.00";
  await billingService.changePlan("sub-a", { ...reason, planId: "plan-b" });
  expect(state.subscriptions[0]).toMatchObject({ billingInterval: "YEARLY", price: "2999.00", expiresAt: yearlyExpiration });
  const monthlyPayment = await billingService.recordPayment({ ...paymentInput, amount: "599.00", referenceNumber: "BANK-MONTHLY", idempotencyKey: "monthly-renewal-key" });
  await billingService.reviewPayment(monthlyPayment.id, reviewInput);
  const { billingPeriod } = await import("@/modules/system-admin/billing-policy.js");
  expect(state.subscriptions[0].expiresAt).toEqual(billingPeriod(state.payments[1].verifiedAt, yearlyExpiration, "MONTHLY").expiresAt);
  expect(state.subscriptions[0].billingInterval).toBe("MONTHLY");
  await billingService.refundPayment(monthlyPayment.id, { ...reason, requestId: await approvedRefundRequest(monthlyPayment.id), evidence: "confirmed-refund-monthly", idempotencyKey: "refund-monthly-key" });
  expect(state.subscriptions[0]).toMatchObject({ billingInterval: "YEARLY", price: "2999.00", expiresAt: yearlyExpiration });
});

test.each(["trial", "paid"])("a canceled %s requires verified payment to restore access on a monthly plan", async (coverage) => {
  jest.useFakeTimers({ now: new Date("2026-10-16T04:00:00Z") });
  try {
    if (coverage === "trial") {
      await billingService.startTrial("sub-a", reason);
    } else {
      const payment = await billingService.recordPayment(paymentInput);
      await billingService.reviewPayment(payment.id, reviewInput);
    }
    await expect(assertTenantEntitlement(tx, "org-a")).resolves.toBeUndefined();
    const previousExpiration = state.subscriptions[0].expiresAt;
    await billingService.changeStatus("sub-a", { ...reason, status: "CANCELED" });

    state.plans[1].billingInterval = "MONTHLY";
    state.plans[1].price = "599.00";
    await billingService.changePlan("sub-a", { ...reason, planId: "plan-b" });
    expect(state.subscriptions[0]).toMatchObject({ status: "CANCELED", planId: "plan-b", expiresAt: previousExpiration });
    await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403, code: "SUBSCRIPTION_REQUIRED" });

    const monthlyPayment = await billingService.recordPayment({ ...paymentInput, amount: "599.00", referenceNumber: "BANK-MONTHLY-RESTART", idempotencyKey: "monthly-restart-key" });
    expect(monthlyPayment.status).toBe("PENDING");
    await expect(assertTenantEntitlement(tx, "org-a")).rejects.toMatchObject({ statusCode: 403, code: "SUBSCRIPTION_REQUIRED" });

    await billingService.reviewPayment(monthlyPayment.id, reviewInput);
    expect(state.subscriptions[0]).toMatchObject({
      status: "ACTIVE", billingInterval: "MONTHLY", price: "599.00", currentPeriodPaymentId: monthlyPayment.id,
      startsAt: new Date("2026-10-16T04:00:00Z"), expiresAt: new Date("2026-11-16T04:00:00Z"),
    });
    await expect(assertTenantEntitlement(tx, "org-a")).resolves.toBeUndefined();
  } finally {
    jest.useRealTimers();
  }
});

test("repeated and competing verification of the same payment cannot renew twice", async () => {
  const payment = await billingService.recordPayment(paymentInput);
  await Promise.all([billingService.reviewPayment(payment.id, reviewInput), billingService.reviewPayment(payment.id, reviewInput)]);
  const expiration = state.subscriptions[0].expiresAt;
  await billingService.reviewPayment(payment.id, reviewInput);
  expect(state.subscriptions[0].expiresAt).toEqual(expiration);
  expect(state.history).toHaveLength(1);
});

test.each([
  { interval: "MONTHLY", price: "299.00", amount: "298.99", currency: "PHP" },
  { interval: "MONTHLY", price: "299.00", amount: "299.01", currency: "PHP" },
  { interval: "MONTHLY", price: "299.00", amount: "299.00", currency: "USD" },
  { interval: "YEARLY", price: "2999.00", amount: "2998.99", currency: "PHP" },
  { interval: "YEARLY", price: "2999.00", amount: "2999.01", currency: "PHP" },
  { interval: "YEARLY", price: "2999.00", amount: "2999.00", currency: "USD" },
])("recording rejects $interval payment of $currency $amount against PHP $price without side effects", async ({ interval, price, amount, currency }) => {
  state.plans[0].billingInterval = interval;
  state.plans[0].price = price;
  const before = structuredClone(state);
  await expect(billingService.recordPayment({ ...paymentInput, amount, currency })).rejects.toMatchObject({ statusCode: 409 });
  expect(state).toEqual(before);
  expect(db.subscriptionPayment.create).not.toHaveBeenCalled();
});

test.each(["2998.99", "2999.01"])("verification still rejects legacy nonexact annual amount %s", async (amount) => {
  const payment = await billingService.recordPayment(paymentInput);
  // Pending receipts from before creation-time validation still require exact verification.
  state.payments[0].amount = amount;
  await expect(billingService.reviewPayment(payment.id, reviewInput)).rejects.toMatchObject({ statusCode: 409 });
  expect(state.subscriptions[0].status).toBe("PENDING");
  expect(state.payments[0].status).toBe("PENDING");
});

test("recording uses the newly selected plan price instead of the previous period price", async () => {
  await billingService.changePlan("sub-a", { ...reason, planId: "plan-b" });
  await expect(billingService.recordPayment(paymentInput)).rejects.toMatchObject({ statusCode: 409 });
  expect(state.payments).toHaveLength(0);
  const payment = await billingService.recordPayment({ ...paymentInput, amount: "5999" });
  expect(payment).toMatchObject({ status: "PENDING", amount: "5999.00" });
  expect(state.subscriptions[0]).toMatchObject({ status: "PENDING", price: "2999.00" });
});

test("recording retries remain idempotent after a plan price change but verification rechecks the price", async () => {
  const payment = await billingService.recordPayment(paymentInput);
  await billingService.changePlan("sub-a", { ...reason, planId: "plan-b" });
  expect((await billingService.recordPayment(paymentInput)).id).toBe(payment.id);
  expect(state.payments).toHaveLength(1);
  await expect(billingService.reviewPayment(payment.id, reviewInput)).rejects.toMatchObject({ statusCode: 409 });
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
  const refund = { ...reason, requestId: await approvedRefundRequest(first.id), evidence: "refund-target-review", idempotencyKey: "shared-refund-key" };
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
  expect(state.subscriptions[0].price).toBe("2999.00");
  expect(state.payments[0].amount).toBe("2999.00");
  const second = await billingService.recordPayment({ ...paymentInput, amount: "5999.00", referenceNumber: "BANK-2026-B", idempotencyKey: "payment-key-b" });
  await billingService.reviewPayment(second.id, reviewInput);
  expect(state.subscriptions[0].price).toBe("5999.00");
  expect(state.payments[0].amount).toBe("2999.00");
});

test("downgrades and seat activation include the owner and blocked active accounts", async () => {
  state.users.push(...["blocked", "staff", "extra"].map((id) => ({ id, organizationId: "org-a", status: "ACTIVE", platformRole: "NONE", securityStatus: "BLOCKED", deletedAt: null })));
  state.subscriptions[0].planId = "plan-b";
  await expect(billingService.changePlan("sub-a", { ...reason, planId: "plan-a" })).rejects.toMatchObject({ statusCode: 409 });
  state.subscriptions[0].planId = "plan-a";
  await expect(enforceSeatLimit(tx, "org-a")).rejects.toMatchObject({ statusCode: 409 });
});

test("pending invites, deleted users and platform identities do not consume active seats", async () => {
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
  const input = { ...reason, requestId: await approvedRefundRequest(payment.id), evidence: "bank-refund:confirmation:A", idempotencyKey: "refund-key-a" };
  const refund = await billingService.refundPayment(payment.id, input);
  expect(new Prisma.Decimal(refund.amount).toFixed(2)).toBe("2999.00");
  expect(state.payments[0].status).toBe("REFUNDED");
  expect(state.subscriptions[0].status).toBe("CANCELED");
  expect((await billingService.refundPayment(payment.id, input)).id).toBe(refund.id);
  expect(state.refunds).toHaveLength(1);
  expect(state.refundRequests[0]).toMatchObject({ status: "COMPLETED", activePaymentId: null });
  expect(state.refundRequests[0].completedAt).toBeInstanceOf(Date);
  expect(refund.requestId).toBe(input.requestId);
});

const requestInput = { ...reason, evidence: "customer-refund-request:ABC", idempotencyKey: "refund-request-key" };
async function verifiedPayment() {
  const payment = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(payment.id, reviewInput);
  return payment;
}

test("refund request and approval preserve revenue, payment and subscription entitlement", async () => {
  const payment = await verifiedPayment();
  const before = structuredClone(state.subscriptions[0]);
  const request = await billingService.requestRefund(payment.id, requestInput);
  expect(request).toMatchObject({ status: "REQUESTED", paymentId: payment.id, activePaymentId: payment.id });
  expect((await billingService.requestRefund(payment.id, requestInput)).id).toBe(request.id);
  await expect(billingService.requestRefund(payment.id, { ...requestInput, reason: "Changed request details" })).rejects.toMatchObject({ statusCode: 409 });
  const review = { ...reason, requestId: request.id, decision: "APPROVED" as const };
  await billingService.reviewRefund(payment.id, review);
  await billingService.reviewRefund(payment.id, review);
  expect(state.refundRequests).toHaveLength(1);
  expect(state.refunds).toHaveLength(0);
  expect(state.payments[0].status).toBe("PAID");
  expect(state.subscriptions[0]).toEqual(before);
  expect(state.audits.filter((event) => event.action === "platform.refund.request")).toHaveLength(1);
  expect(state.audits.filter((event) => event.action === "platform.refund.approve")).toHaveLength(1);
});

test("concurrent duplicate and distinct refund requests cannot create multiple open requests", async () => {
  const payment = await verifiedPayment();
  const identical = await Promise.all([billingService.requestRefund(payment.id, requestInput), billingService.requestRefund(payment.id, requestInput)]);
  expect(identical[0].id).toBe(identical[1].id);
  await expect(billingService.requestRefund(payment.id, { ...requestInput, idempotencyKey: "another-request-key" })).rejects.toMatchObject({ statusCode: 409 });
  expect(state.refundRequests).toHaveLength(1);
});

test.each(["REQUESTED", "APPROVED"] as const)("rejecting a %s request preserves history and allows a new request", async (status) => {
  const payment = await verifiedPayment();
  const request = await billingService.requestRefund(payment.id, requestInput);
  if (status === "APPROVED") await billingService.reviewRefund(payment.id, { ...reason, requestId: request.id, decision: "APPROVED" });
  await billingService.reviewRefund(payment.id, { ...reason, requestId: request.id, decision: "REJECTED" });
  expect(state.refundRequests[0]).toMatchObject({ status: "REJECTED", activePaymentId: null, reviewedBy: "platform-actor" });
  await expect(billingService.reviewRefund(payment.id, { ...reason, requestId: request.id, decision: "APPROVED" })).rejects.toMatchObject({ statusCode: 409 });
  await billingService.requestRefund(payment.id, { ...requestInput, idempotencyKey: "fresh-request-key" });
  expect(state.refundRequests).toHaveLength(2);
  expect(state.payments[0].status).toBe("PAID");
  expect(state.subscriptions[0].status).toBe("ACTIVE");
  expect(state.refunds).toHaveLength(0);
});

test("unapproved requests and requests belonging to another payment cannot complete", async () => {
  const payment = await verifiedPayment();
  const request = await billingService.requestRefund(payment.id, requestInput);
  const completion = { ...reason, requestId: request.id, evidence: "bank-return-reference", idempotencyKey: "complete-refund-key" };
  await expect(billingService.refundPayment(payment.id, completion)).rejects.toMatchObject({ statusCode: 409 });
  const other = await billingService.recordPayment({ ...paymentInput, referenceNumber: "OTHER-PAYMENT", idempotencyKey: "other-payment-key" });
  await billingService.reviewPayment(other.id, reviewInput);
  await expect(billingService.reviewRefund(other.id, { ...reason, requestId: request.id, decision: "APPROVED" })).rejects.toMatchObject({ statusCode: 404 });
  await expect(billingService.refundPayment(other.id, completion)).rejects.toMatchObject({ statusCode: 404 });
  await expect(billingService.requestRefund(other.id, requestInput)).rejects.toMatchObject({ statusCode: 409 });
  expect(state.refunds).toHaveLength(0);
});

test.each(["PENDING", "REJECTED", "REFUNDED"])("payment status %s cannot start a refund", async (status) => {
  const payment = await billingService.recordPayment(paymentInput);
  state.payments[0].status = status;
  await expect(billingService.requestRefund(payment.id, requestInput)).rejects.toMatchObject({ statusCode: 409 });
  expect(state.refundRequests).toHaveLength(0);
});

test("refund completion retries are exact and completed requests cannot be rejected", async () => {
  const payment = await verifiedPayment();
  const requestId = await approvedRefundRequest(payment.id);
  const input = { ...reason, requestId, evidence: "bank-return-reference", idempotencyKey: "complete-refund-key" };
  const [first, second] = await Promise.all([billingService.refundPayment(payment.id, input), billingService.refundPayment(payment.id, input)]);
  expect(first.id).toBe(second.id);
  await expect(billingService.refundPayment(payment.id, { ...input, requestId: "different-request" })).rejects.toMatchObject({ statusCode: 409 });
  await expect(billingService.refundPayment(payment.id, { ...input, evidence: "changed-return-reference" })).rejects.toMatchObject({ statusCode: 409 });
  await expect(billingService.reviewRefund(payment.id, { ...reason, requestId, decision: "REJECTED" })).rejects.toMatchObject({ statusCode: 409 });
  expect(state.refunds).toHaveLength(1);
});

test("audit failure rolls back requests, reviews, refund ledger, completion and subscription changes", async () => {
  const payment = await verifiedPayment();
  failAudit = true;
  await expect(billingService.requestRefund(payment.id, requestInput)).rejects.toThrow("Audit unavailable");
  expect(state.refundRequests).toHaveLength(0);
  failAudit = false;
  const request = await billingService.requestRefund(payment.id, requestInput);
  failAudit = true;
  await expect(billingService.reviewRefund(payment.id, { ...reason, requestId: request.id, decision: "APPROVED" })).rejects.toThrow("Audit unavailable");
  expect(state.refundRequests[0].status).toBe("REQUESTED");
  failAudit = false;
  await billingService.reviewRefund(payment.id, { ...reason, requestId: request.id, decision: "APPROVED" });
  const before = structuredClone(state.subscriptions[0]);
  failAudit = true;
  await expect(billingService.refundPayment(payment.id, { ...reason, requestId: request.id, evidence: "bank-return-reference", idempotencyKey: "complete-refund-key" })).rejects.toThrow("Audit unavailable");
  expect(state.refundRequests[0].status).toBe("APPROVED");
  expect(state.refunds).toHaveLength(0);
  expect(state.payments[0].status).toBe("PAID");
  expect(state.subscriptions[0]).toEqual(before);
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
  await billingService.refundPayment(second.id, { ...reason, requestId: await approvedRefundRequest(second.id), evidence: "future-renewal-refund", idempotencyKey: "future-refund-key" });
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
  await billingService.refundPayment(first.id, { ...reason, requestId: await approvedRefundRequest(first.id), evidence: "historic-refund-review", idempotencyKey: "historic-refund-key" });
  expect(state.subscriptions[0]).toMatchObject({ status: "ACTIVE", currentPeriodPaymentId: second.id, expiresAt: currentExpiry });
  await billingService.refundPayment(second.id, { ...reason, requestId: await approvedRefundRequest(second.id), evidence: "future-renewal-refund", idempotencyKey: "future-refund-key" });
  expect(state.subscriptions[0].status).toBe("CANCELED");
});

test("refunding current coverage cannot grant access during a gap before a future renewal", async () => {
  const first = await billingService.recordPayment(paymentInput);
  await billingService.reviewPayment(first.id, reviewInput);
  const second = await billingService.recordPayment({ ...paymentInput, referenceNumber: "BANK-FUTURE", idempotencyKey: "future-key" });
  await billingService.reviewPayment(second.id, reviewInput);
  await billingService.refundPayment(first.id, { ...reason, requestId: await approvedRefundRequest(first.id), evidence: "current-period-refund", idempotencyKey: "current-refund-key" });
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
  await billingService.refundPayment(second.id, { ...reason, requestId: await approvedRefundRequest(second.id), evidence: "restart-period-refund", idempotencyKey: "restart-refund-key" });
  expect(state.payments[0].status).toBe("PAID");
  expect(state.subscriptions[0].status).toBe("CANCELED");
});
