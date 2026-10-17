import { jest } from "@jest/globals";
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client.js";
import { brightStarId, brightStarCustomerData, inspectBrightStarSeed, seedBrightStar } from "../../prisma/seeds/bright-star.js";
import { brightStarScenarios, brightStarServices, brightStarCustomers, brightStarDate } from "../../prisma/seeds/bright-star-data.js";
import { createCustomerSchema } from "../../src/modules/customer/customer.schema.js";
import { validateTransition } from "../../src/modules/service-request/lifecycle.js";

const sorted = (values: string[]) => [...new Set(values)].sort();

test("fixtures cover every request, priority, job, invoice and payment-method option", () => {
  expect(sorted(brightStarScenarios.map((row) => row.status))).toEqual(["CANCELLED", "COMPLETED", "IN_PROGRESS", "PENDING"]);
  expect(sorted(brightStarScenarios.map((row) => row.priority))).toEqual(["HIGH", "LOW", "NORMAL", "URGENT"]);
  expect(sorted(brightStarScenarios.flatMap((row) => row.jobs.map((job) => job.status)))).toEqual(["ASSIGNED", "CANCELLED", "COMPLETED", "IN_PROGRESS"]);
  expect(sorted(brightStarScenarios.flatMap((row) => row.invoice ? [row.invoice.status] : []))).toEqual(["PAID", "PARTIALLY_PAID", "UNPAID", "VOID"]);
  expect(sorted(brightStarScenarios.flatMap((row) => row.invoice?.method ? [row.invoice.method] : []))).toEqual(["BANK_TRANSFER", "CARD", "CASH", "GCASH", "OTHER"]);
});

test("completed and cancelled requests satisfy the actual backend lifecycle rules", () => {
  for (const scenario of brightStarScenarios) {
    if (scenario.status === "COMPLETED") expect(() => validateTransition("IN_PROGRESS", "COMPLETED", scenario.jobs)).not.toThrow();
    if (scenario.status === "CANCELLED") expect(() => validateTransition("PENDING", "CANCELLED", scenario.jobs)).not.toThrow();
    if (scenario.invoice) {
      expect(scenario.status).toBe("COMPLETED");
      expect(scenario.jobs[0]?.status).toBe("COMPLETED");
      if (["PAID", "PARTIALLY_PAID"].includes(scenario.invoice.status)) expect(scenario.invoice.method).toBeDefined();
    }
    expect(brightStarCustomers[scenario.customer]?.archived).not.toBe(true);
    expect(brightStarServices[scenario.service]?.isActive).not.toBe(false);
    expect(scenario.jobs.every((job) => job.description.length <= 191)).toBe(true);
  }
});

test("dashboard fixtures include dispatch, ready-to-close, ready-to-invoice, late, today, unscheduled and multi-job work", () => {
  expect(brightStarScenarios.some((row) => row.status === "PENDING" && !row.jobs.length)).toBe(true);
  expect(brightStarScenarios.some((row) => row.status === "IN_PROGRESS" && row.jobs.every((job) => job.status === "COMPLETED"))).toBe(true);
  expect(brightStarScenarios.some((row) => row.status === "COMPLETED" && !row.invoice)).toBe(true);
  const jobs = brightStarScenarios.flatMap((row) => row.jobs);
  expect(jobs.some((job) => job.status === "IN_PROGRESS" && job.day < 0)).toBe(true);
  expect(jobs.some((job) => job.status === "ASSIGNED" && job.day === 0)).toBe(true);
  expect(jobs.some((job) => job.unscheduled && job.unassigned)).toBe(true);
  expect(brightStarScenarios.some((row) => row.jobs.length > 1 && new Set(row.jobs.map((job) => job.status)).size > 1)).toBe(true);
});

test("sample customers pass current validation, have unique contacts and use reserved email addresses", () => {
  const rows = brightStarCustomers.map((_, index) => brightStarCustomerData("org-a", index));
  for (const row of rows) {
    const { name, address, email, phoneNumber, notes } = row;
    expect(() => createCustomerSchema.parse({ body: { name, address, email, phoneNumber, notes } })).not.toThrow();
    expect(email.endsWith(".test")).toBe(true);
    expect(notes.length).toBeLessThanOrEqual(191);
  }
  expect(new Set(rows.map((row) => row.phoneNumber)).size).toBe(rows.length);
  expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
});

test("stable IDs are tenant-specific and Manila dates cross UTC day/month boundaries correctly", () => {
  expect(brightStarId("org-a", "request:01")).toBe(brightStarId("org-a", "request:01"));
  expect(brightStarId("org-a", "request:01")).not.toBe(brightStarId("org-b", "request:01"));
  expect(brightStarId("org-a", "request:01")).toMatch(/^c[a-f0-9]{24}$/);
  const now = new Date("2026-10-01T00:30:00+08:00");
  expect(brightStarDate(now, 0, 0).toISOString()).toBe("2026-09-30T16:00:00.000Z");
  expect(brightStarDate(now, -1, 9).toISOString()).toBe("2026-09-30T01:00:00.000Z");
});

function fixture() {
  const organization = { id: "org-a", name: "Bright Star Electrical", slug: "bright-star-electrical", status: "ACTIVE" };
  const users = ["Admin", "Manager", "Staff"].map((name) => ({ id: name.toLowerCase(), role: { name } }));
  const db = {
    $queryRaw: jest.fn(async () => []),
    organization: { findUnique: jest.fn(async () => organization as typeof organization | null) },
    user: { findMany: jest.fn(async () => users) },
    auditLog: { findUnique: jest.fn(async () => null as any) },
    customer: { findFirst: jest.fn(async () => null as { id: string } | null) },
  };
  return { db, organization, users, transaction: db as unknown as Prisma.TransactionClient };
}

test("preflight refuses a missing or inactive organization", async () => {
  const state = fixture();
  state.db.organization.findUnique.mockResolvedValueOnce(null);
  await expect(inspectBrightStarSeed(state.transaction)).rejects.toThrow("was not found");
  state.organization.status = "SUSPENDED";
  await expect(inspectBrightStarSeed(state.transaction)).rejects.toThrow("must be active");
});

test("preflight requires active tenant actors and selects no passwords or tokens", async () => {
  const state = fixture();
  state.users.pop();
  await expect(inspectBrightStarSeed(state.transaction)).rejects.toThrow("Admin, Manager and Staff");
  const args = state.db.user.findMany.mock.calls[0] as any;
  expect(args[0].where).toMatchObject({ organizationId: "org-a", status: "ACTIVE", deletedAt: null, securityStatus: "ACTIVE", platformRole: "NONE", role: { organizationId: "org-a", deletedAt: null } });
  expect(args[0].select).toEqual({ id: true, role: { select: { name: true } } });
});

test("global customer uniqueness conflicts fail preflight rather than linking another tenant's record", async () => {
  const state = fixture();
  state.db.customer.findFirst.mockResolvedValueOnce({ id: "another-tenant-customer" });
  await expect(inspectBrightStarSeed(state.transaction)).rejects.toThrow("conflicts with an existing record");
});

test("a marker belonging to a different tenant cannot skip the seed", async () => {
  const state = fixture();
  state.db.auditLog.findUnique.mockResolvedValue({ organizationId: "org-b", entityId: "org-b", action: "seed.bright_star.completed" });
  await expect(inspectBrightStarSeed(state.transaction)).rejects.toThrow("ownership mismatch");
});

test("reruns lock the tenant and return the original batch without updating business records", async () => {
  const state = fixture();
  state.db.auditLog.findUnique.mockResolvedValue({ organizationId: "org-a", entityId: "org-a", action: "seed.bright_star.completed", metadata: { jobs: 25 } });
  const $transaction = jest.fn(async (work: (db: Prisma.TransactionClient) => Promise<unknown>) => work(state.transaction));
  const result = await seedBrightStar({ $transaction } as unknown as PrismaClient);
  expect(result).toEqual({ status: "already-seeded", organizationId: "org-a", summary: { jobs: 25 } });
  expect(state.db.$queryRaw).toHaveBeenCalledTimes(1);
  expect(state.db.customer.findFirst).not.toHaveBeenCalled();
});
