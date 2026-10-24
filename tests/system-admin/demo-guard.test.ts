import { jest } from "@jest/globals";
import type { Prisma } from "@/generated/prisma/client.js";
import { assertDemoActionAllowed } from "@/lib/demo-guard.js";

const findUnique = jest.fn<(input: unknown) => Promise<{ isDemo: boolean } | null>>();
const db = { organization: { findUnique } } as unknown as Prisma.TransactionClient;
beforeEach(() => { findUnique.mockReset(); });

test("live organizations retain access through the persisted tenant lookup", async () => {
  findUnique.mockResolvedValue({ isDemo: false });
  await expect(assertDemoActionAllowed(db, "trusted-tenant", "record payments")).resolves.toBeUndefined();
  expect(findUnique).toHaveBeenCalledWith({ where: { id: "trusted-tenant" }, select: { isDemo: true } });
});

test("demo organizations are rejected without a client mode override", async () => {
  findUnique.mockResolvedValue({ isDemo: true });
  await expect(assertDemoActionAllowed(db, "demo-tenant", "record payments")).rejects.toMatchObject({ statusCode: 403, code: "DEMO_ACTION_DISABLED" });
});

test("missing organizations and failed mode lookups fail closed", async () => {
  findUnique.mockResolvedValue(null);
  await expect(assertDemoActionAllowed(db, "missing-tenant", "record payments")).rejects.toMatchObject({ statusCode: 404 });
  findUnique.mockRejectedValue(new Error("Database unavailable"));
  await expect(assertDemoActionAllowed(db, "unknown-tenant", "record payments")).rejects.toThrow("Database unavailable");
});
