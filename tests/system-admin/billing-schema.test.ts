import { createPlanSchema, updatePlanSchema, recordPaymentSchema, reviewPaymentSchema, refundPaymentSchema, changeSubscriptionStatusSchema, assignSubscriptionSchema, startTrialSchema, subscriptionListSchema } from "@/modules/system-admin/billing.schema.js";
const mutation = { reason: "Confirmed billing adjustment", confirm: true };
const plan = { ...mutation, name: "Starter", price: "2999.00", currency: "PHP", maxActiveUsers: 3 };
const payment = { ...mutation, subscriptionId: "sub-a", amount: "2999.00", currency: "PHP", paymentMethod: "BANK_TRANSFER",
  referenceNumber: "BANK-VALID-REFERENCE", idempotencyKey: "payment-key-a", paidAt: new Date(Date.now() - 1000).toISOString() };

test("trial enrollment accepts only a boolean choice; dates, duration and status are server controlled", () => {
  const body = { ...mutation, organizationId: "org-a", planId: "plan-a", startTrial: true };
  expect(assignSubscriptionSchema.safeParse({ body }).success).toBe(true);
  expect(assignSubscriptionSchema.safeParse({ body: { ...body, startTrial: "true" } }).success).toBe(false);
  for (const field of ["trialDays", "trialStartedAt", "trialExpiresAt", "status"]) {
    expect(assignSubscriptionSchema.safeParse({ body: { ...body, [field]: 100 } }).success).toBe(false);
    expect(startTrialSchema.safeParse({ params: { id: "sub-a" }, body: { ...mutation, [field]: 100 } }).success).toBe(false);
  }
  expect(startTrialSchema.safeParse({ params: { id: "sub-a" }, body: mutation }).success).toBe(true);
  expect(startTrialSchema.safeParse({ params: { id: "sub-a" }, body: { ...mutation, confirm: false } }).success).toBe(false);
  expect(subscriptionListSchema.parse({ query: { status: "TRIALING" } }).query.status).toBe("TRIALING");
});

test("partial plan edits never apply create defaults or reactivate retired plans", () => {
  const result = updatePlanSchema.parse({ params: { id: "plan-a" }, body: { ...mutation, price: "3999.00" } });
  expect(result.body).toEqual({ ...mutation, price: "3999.00" });
  expect(result.body).not.toHaveProperty("isActive");
  expect(result.body).not.toHaveProperty("currency");
  expect(result.body).not.toHaveProperty("billingInterval");
  expect(updatePlanSchema.safeParse({ params: { id: "plan-a" }, body: mutation }).success).toBe(false);
});

test("plans accept monthly and yearly billing while rejecting unsupported intervals", () => {
  expect(createPlanSchema.parse({ body: plan }).body.billingInterval).toBe("YEARLY");
  expect(createPlanSchema.parse({ body: { ...plan, billingInterval: "MONTHLY", price: "299.00" } }).body.billingInterval).toBe("MONTHLY");
  expect(createPlanSchema.safeParse({ body: { ...plan, billingInterval: "WEEKLY" } }).success).toBe(false);
  expect(updatePlanSchema.parse({ params: { id: "plan-a" }, body: { ...mutation, billingInterval: "MONTHLY" } }).body.billingInterval).toBe("MONTHLY");
});

test.each(["2999.001", "1e3", "-1.00", "0", "10000000000.00", "NaN", 2999])("rejects unsafe monetary input %s", (amount) => {
  expect(recordPaymentSchema.safeParse({ body: { ...payment, amount } }).success).toBe(false);
});

test("sensitive billing inputs require explicit reason, confirmation and verification evidence", () => {
  expect(createPlanSchema.safeParse({ body: { ...plan, confirm: false } }).success).toBe(false);
  expect(createPlanSchema.safeParse({ body: { ...plan, reason: "" } }).success).toBe(false);
  expect(reviewPaymentSchema.safeParse({ params: { id: "payment-a" }, body: { ...mutation, decision: "PAID", evidence: "" } }).success).toBe(false);
  expect(reviewPaymentSchema.safeParse({ params: { id: "payment-a" }, body: { ...mutation, decision: "PAID", evidence: "statement:A" } }).success).toBe(true);
});

test("strict schemas reject client privilege and payment-state assignment", () => {
  expect(createPlanSchema.safeParse({ body: { ...plan, platformRole: "SYSTEM_ADMIN" } }).success).toBe(false);
  expect(recordPaymentSchema.safeParse({ body: { ...payment, organizationId: "foreign-org" } }).success).toBe(false);
  expect(recordPaymentSchema.safeParse({ body: { ...payment, status: "PAID" } }).success).toBe(false);
  expect(changeSubscriptionStatusSchema.safeParse({ params: { id: "sub-a" }, body: { ...mutation, status: "ACTIVE" } }).success).toBe(false);
});

test("full refund schema rejects partial amounts and future payment dates", () => {
  expect(refundPaymentSchema.safeParse({ params: { id: "payment-a" }, body: { ...mutation, evidence: "refund:A", idempotencyKey: "refund-key-a", amount: "1.00" } }).success).toBe(false);
  expect(recordPaymentSchema.safeParse({ body: { ...payment, paidAt: new Date(Date.now() + 86_400_000).toISOString() } }).success).toBe(false);
});
