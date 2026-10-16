import { annualPeriod, assertManualSubscriptionTransition, assertExactAnnualPayment, entitlementIsCurrent } from "@/modules/system-admin/billing-policy.js";

test("renewal starts at the later of now or the current expiration", () => {
  const now = new Date("2026-10-15T05:00:00.000Z");
  expect(annualPeriod(now, new Date("2027-03-01T05:00:00.000Z"))).toEqual({
    startsAt: new Date("2027-03-01T05:00:00.000Z"), expiresAt: new Date("2028-03-01T05:00:00.000Z"),
  });
  expect(annualPeriod(now, new Date("2025-03-01T05:00:00.000Z"))).toEqual({
    startsAt: now, expiresAt: new Date("2027-10-15T05:00:00.000Z"),
  });
});

test("a leap-day annual period ends on the final day of February", () => {
  expect(annualPeriod(new Date("2028-02-29T09:30:00.000Z"), null).expiresAt)
    .toEqual(new Date("2029-02-28T09:30:00.000Z"));
});

test("payments require exact decimal amount and currency", () => {
  expect(() => assertExactAnnualPayment("2999.00", "PHP", "2999", "PHP")).not.toThrow();
  expect(() => assertExactAnnualPayment("2998.99", "PHP", "2999.00", "PHP")).toThrow();
  expect(() => assertExactAnnualPayment("2999.01", "PHP", "2999.00", "PHP")).toThrow();
  expect(() => assertExactAnnualPayment("2999.00", "USD", "2999.00", "PHP")).toThrow();
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
