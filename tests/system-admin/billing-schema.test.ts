import { createPlanSchema, updatePlanSchema, recordPaymentSchema, reviewPaymentSchema, refundPaymentSchema, changeSubscriptionStatusSchema } from "@/modules/system-admin/billing.schema.js";
const mutation = { reason: "Confirmed billing adjustment", confirm: true };
const plan = { ...mutation, name: "Starter", annualPrice: "2999.00", currency: "PHP", maxActiveUsers: 3 };
const payment = { ...mutation, subscriptionId: "sub-a", amount: "2999.00", currency: "PHP", paymentMethod: "BANK_TRANSFER",
  referenceNumber: "BANK-VALID-REFERENCE", idempotencyKey: "payment-key-a", paidAt: new Date(Date.now() - 1000).toISOString() };

test("partial plan edits never apply create defaults or reactivate retired plans", () => {
  const result = updatePlanSchema.parse({ params: { id: "plan-a" }, body: { ...mutation, annualPrice: "3999.00" } });
  expect(result.body).toEqual({ ...mutation, annualPrice: "3999.00" });
  expect(result.body).not.toHaveProperty("isActive");
  expect(result.body).not.toHaveProperty("currency");
  expect(updatePlanSchema.safeParse({ params: { id: "plan-a" }, body: mutation }).success).toBe(false);
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
