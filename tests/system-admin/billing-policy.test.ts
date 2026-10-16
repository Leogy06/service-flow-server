import { billingPeriod, assertManualSubscriptionTransition, assertExactPayment, entitlementIsCurrent, trialPeriod } from "@/modules/system-admin/billing-policy.js";

test("free trials last exactly 14 days and preserve UTC time across month boundaries", () => {
  const now = new Date("2026-12-25T09:30:00.000Z");
  expect(trialPeriod(now)).toEqual({ trialStartedAt: now, trialExpiresAt: new Date("2027-01-08T09:30:00.000Z") });
});

test("trial access requires valid trial dates and ends exactly at expiry without grace", () => {
  const start = new Date("2026-10-16T05:00:00.000Z");
  const end = new Date("2026-10-30T05:00:00.000Z");
  const subscription = { status: "TRIALING", startsAt: start, expiresAt: end, trialStartedAt: start, trialExpiresAt: end };
  expect(entitlementIsCurrent(subscription, 30, start)).toBe(true);
  expect(entitlementIsCurrent(subscription, 30, new Date(+end - 1))).toBe(true);
  expect(entitlementIsCurrent(subscription, 30, end)).toBe(false);
  expect(entitlementIsCurrent(subscription, 30, new Date(+start - 1))).toBe(false);
  expect(entitlementIsCurrent({ ...subscription, trialStartedAt: null }, 30, start)).toBe(false);
  expect(entitlementIsCurrent({ ...subscription, trialExpiresAt: null }, 30, start)).toBe(false);
  expect(entitlementIsCurrent({ ...subscription, expiresAt: new Date(+end + 86400000) }, 30, end)).toBe(false);
});

test("a trial can be canceled but cannot be changed to paid or past due manually", () => {
  expect(() => assertManualSubscriptionTransition("TRIALING", "CANCELED")).not.toThrow();
  expect(() => assertManualSubscriptionTransition("TRIALING", "PAST_DUE")).toThrow();
  expect(() => assertManualSubscriptionTransition("TRIALING", "ACTIVE")).toThrow();
});

test("renewal starts at the later of now or the current expiration", () => {
  const now = new Date("2026-10-15T05:00:00.000Z");
  expect(billingPeriod(now, new Date("2027-03-01T05:00:00.000Z"))).toEqual({
    startsAt: new Date("2027-03-01T05:00:00.000Z"), expiresAt: new Date("2028-03-01T05:00:00.000Z"),
  });
  expect(billingPeriod(now, new Date("2025-03-01T05:00:00.000Z"))).toEqual({
    startsAt: now, expiresAt: new Date("2027-10-15T05:00:00.000Z"),
  });
});

test("a leap-day annual period ends on the final day of February", () => {
  expect(billingPeriod(new Date("2028-02-29T09:30:00.000Z"), null).expiresAt)
    .toEqual(new Date("2029-02-28T09:30:00.000Z"));
});

test.each([
  ["2026-01-31T09:30:00.000Z", "2026-02-28T09:30:00.000Z"],
  ["2028-01-31T09:30:00.000Z", "2028-02-29T09:30:00.000Z"],
  ["2026-03-31T09:30:00.000Z", "2026-04-30T09:30:00.000Z"],
  ["2026-12-15T09:30:00.000Z", "2027-01-15T09:30:00.000Z"],
])("monthly coverage clamps month-end and preserves UTC time: %s", (start, end) => {
  expect(billingPeriod(new Date(start), null, "MONTHLY").expiresAt).toEqual(new Date(end));
});

test("an early monthly renewal extends from paid expiration", () => {
  const expiration = new Date("2026-12-31T09:30:00.000Z");
  expect(billingPeriod(new Date("2026-12-01T09:30:00.000Z"), expiration, "MONTHLY"))
    .toEqual({ startsAt: expiration, expiresAt: new Date("2027-01-31T09:30:00.000Z") });
});

test("payments require exact decimal amount and currency", () => {
  expect(() => assertExactPayment("2999.00", "PHP", "2999", "PHP")).not.toThrow();
  expect(() => assertExactPayment("2998.99", "PHP", "2999.00", "PHP")).toThrow();
  expect(() => assertExactPayment("2999.01", "PHP", "2999.00", "PHP")).toThrow();
  expect(() => assertExactPayment("2999.00", "USD", "2999.00", "PHP")).toThrow();
});

test.each(["PENDING", "ACTIVE", "PAST_DUE", "EXPIRED", "CANCELED"])("manual activation of %s is rejected", (status) => {
  expect(() => assertManualSubscriptionTransition(status, "ACTIVE")).toThrow();
});

test("valid manual restrictions do not create or extend a paid entitlement", () => {
  expect(() => assertManualSubscriptionTransition("ACTIVE", "PAST_DUE")).not.toThrow();
  expect(() => assertManualSubscriptionTransition("ACTIVE", "CANCELED")).not.toThrow();
  expect(() => assertManualSubscriptionTransition("PAST_DUE", "CANCELED")).not.toThrow();
  expect(() => assertManualSubscriptionTransition("CANCELED", "PAST_DUE")).toThrow();
});

test("active entitlement requires a paid, started and unexpired annual period", () => {
  const now = new Date("2026-10-15T05:00:00Z");
  const subscription = { status: "ACTIVE", startsAt: new Date("2026-01-01T00:00:00Z"), expiresAt: new Date("2027-01-01T00:00:00Z") };
  expect(entitlementIsCurrent(subscription, 0, now)).toBe(true);
  expect(entitlementIsCurrent({ ...subscription, startsAt: new Date("2026-11-01T00:00:00Z") }, 0, now)).toBe(false);
  expect(entitlementIsCurrent({ ...subscription, expiresAt: now }, 0, now)).toBe(false);
  expect(entitlementIsCurrent({ ...subscription, startsAt: null }, 0, now)).toBe(false);
  expect(entitlementIsCurrent(null, 0, now)).toBe(false);
});

test("only PAST_DUE can use an explicitly configured grace period", () => {
  const now = new Date("2026-10-15T05:00:00Z");
  const subscription = { status: "PAST_DUE", startsAt: new Date("2025-10-14T05:00:00Z"), expiresAt: new Date("2026-10-14T05:00:00Z") };
  expect(entitlementIsCurrent(subscription, 0, now)).toBe(false);
  expect(entitlementIsCurrent(subscription, 2, now)).toBe(true);
  expect(entitlementIsCurrent({ ...subscription, status: "CANCELED" }, 2, now)).toBe(false);
  expect(entitlementIsCurrent({ ...subscription, status: "EXPIRED" }, 2, now)).toBe(false);
});
