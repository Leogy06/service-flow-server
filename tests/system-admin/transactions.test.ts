import { jest } from "@jest/globals";
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: {} }));
const { isTransactionConflict } = await import("@/utils/tenant-transaction.js");
test.each(["P2034", 1020, "1205", 1213])("serialization conflict %s is recognized", (code) => {
  expect(isTransactionConflict({ code })).toBe(true);
});
test("Prisma MariaDB native errors are recognized without treating arbitrary SQL failures as conflicts", () => {
  expect(isTransactionConflict(new Error("Database error. Code: `1020`. Message: `Record has changed since last read`"))).toBe(true);
  expect(isTransactionConflict(new Error("Database error. Code: `1644`. Message: `Platform audit records are immutable`"))).toBe(false);
  expect(isTransactionConflict({ code: "P2002" })).toBe(false);
  expect(isTransactionConflict(null)).toBe(false);
});
