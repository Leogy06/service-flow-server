import { jest } from "@jest/globals";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { PERMISSIONS as P } from "../../src/constants/permission.constants.js";

// Exercise actual routes, authorization, validation, services and error responses.
// Only infrastructure is replaced; the predicate evaluator implements ORM filters.
type Row = Record<string, any>;
let jobs: Row[];
let parent: Row;
let sessions: Record<string, Row>;
let limited = false;
const date = (hour: number) => new Date(`2099-01-02T${String(hour).padStart(2, "0")}:00:00Z`);
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === "OR") return value.some((clause: Row) => matches(row, clause));
    if (key === "AND") return value.every((clause: Row) => matches(row, clause));
    if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      return Object.entries(value).every(([operator, target]: [string, any]) => {
        if (operator === "not") return row[key] !== target;
        if (operator === "lt") return row[key] != null && row[key] < target;
        if (operator === "gt") return row[key] != null && row[key] > target;
        return row[key] != null && matches(row[key], { [operator]: target });
      });
    }
    return row[key] instanceof Date && value instanceof Date
      ? row[key].getTime() === value.getTime() : row[key] === value;
  });
}
const audit = jest.fn(async (_db: unknown, _entry: Row) => {});
const invalidate = jest.fn(async () => {});
const db = {
  user: {
    findUnique: jest.fn(async ({ where }: Row) => sessions[where.id] ?? null),
    findFirst: jest.fn(async ({ where }: Row) => where.organizationId === "org-a" &&
      ["staff-a", "staff-other"].includes(where.id) ? { id: where.id } : null),
  },
  customer: { findFirst: jest.fn(async () => ({ id: "customer-a" })) },
  serviceType: { findFirst: jest.fn(async () => ({ id: "type-a" })) },
  serviceRequest: {
    findFirst: jest.fn(async ({ where }: Row) => matches(parent, where) ? { ...parent } : null),
    update: jest.fn(async ({ data }: Row) => Object.assign(parent, data)),
  },
  job: {
    findFirst: jest.fn(async ({ where }: Row) => {
      const row = jobs.find((job) => matches(job, where)); return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where }: Row) => jobs.filter((job) => matches(job, where)).map(({ id, status, scheduledStart, scheduledEnd }) => ({ id, status, scheduledStart, scheduledEnd }))),
    findFirstOrThrow: jest.fn(async ({ where }: Row) => jobs.find((job) => matches(job, where))!),
    create: jest.fn(async ({ data }: Row) => {
      expect(data).not.toHaveProperty("overrideStaffConflict");
      const row = { id: "created", ...data }; jobs.push(row); return row;
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      expect(data).not.toHaveProperty("overrideStaffConflict");
      return Object.assign(jobs.find((job) => matches(job, where))!, data);
    }),
  },
  $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ isolationLevel: "Serializable" });
    const snapshot = structuredClone({ jobs, parent });
    try { return await work(db); }
    catch (error) { jobs = snapshot.jobs; parent = snapshot.parent; throw error; }
  }),
};
jest.unstable_mockModule("@/lib/prisma.js", () => ({ prisma: db }));
jest.unstable_mockModule("@/utils/cache.js", () => ({
  DEFAULT_TTL_SECONDS: 60,
  getOrSetCache: async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
  invalidateCache: invalidate,
}));
jest.unstable_mockModule("@/modules/audit/audit.service.js", () => ({ auditService: { recordInTransaction: audit } }));
jest.unstable_mockModule("@/lib/logger.js", () => ({ logger: { error: jest.fn() } }));
jest.unstable_mockModule("@/utils/tokens.js", () => ({ verifyAccessToken: (sub: string) => ({ sub, organizationId: "org-b" }) }));
jest.unstable_mockModule("@/middleware/rateLimiter.js", () => ({ writeLimmiter: ((_req, res, next) => {
  if (limited) { res.setHeader("Retry-After", "60"); res.status(429).json({ error: "Too many requests" }); }
  else next();
}) as RequestHandler }));
const { authenticate } = await import("@/middleware/auth.js");
const { withRequestContext } = await import("@/middleware/requestContext.middleware.js");
const { errorHandler } = await import("@/middleware/errorHandler.js");
const { default: routes } = await import("@/modules/job/job.routes.js");
const app = express();
app.use(express.json(), withRequestContext);
app.use("/jobs", authenticate, routes);
app.use(errorHandler);
function actor(id: string, organizationId: string | null, permissions: string[]) {
  return { id, email: `${id}@example.invalid`, firstName: id, lastName: "User", status: "ACTIVE", deletedAt: null,
    organizationId, platformRole: organizationId ? "NONE" : "SYSTEM_ADMIN", securityStatus: "ACTIVE", sessionVersion: 0,
    organization: organizationId ? { id: organizationId, slug: organizationId, status: "ACTIVE", billingEnabled: false } : null,
    role: { name: "Staff", organizationId, deletedAt: null, permissions: permissions.map((name) => ({ permission: { name, id: name, organizationId: null } })) },
    userPermissions: [] };
}
const input = (extra: Row = {}) => ({ serviceRequestId: "request-a", assignedStaffId: "staff-a",
  description: "Work", scheduledStart: date(10).toISOString(), scheduledEnd: date(12).toISOString(), ...extra });
const row = (extra: Row = {}) => ({ id: "other", referenceNumber: "PRIVATE-REF", organizationId: "org-a", assignedStaffId: "staff-a",
  serviceRequestId: "request-a", status: "ASSIGNED", scheduledStart: date(11), scheduledEnd: date(13),
  internalNotes: "PRIVATE-NOTES", ...extra });
const send = (method: "post" | "put" | "patch", path: string, body: Row, user = "writer") =>
  request(app)[method]("/jobs" + path).set("Authorization", `Bearer ${user}`).send(body);
beforeEach(() => {
  jest.clearAllMocks(); limited = false;
  parent = { id: "request-a", organizationId: "org-a", customerId: "customer-a", serviceTypeId: "type-a", status: "PENDING" };
  jobs = [row({ id: "current", assignedStaffId: "staff-other", scheduledStart: date(14), scheduledEnd: date(15) })];
  sessions = {
    writer: actor("writer", "org-a", [P.JOB_CREATE, P.JOB_UPDATE, P.JOB_DELETE]),
    reader: actor("reader", "org-a", [P.JOB_READ]),
    foreign: actor("foreign", "org-b", [P.JOB_CREATE, P.JOB_UPDATE]),
    platform: actor("platform", null, []),
  };
});

describe("Staff scheduling warnings", () => {
  it("warns before creating overlapping work, without writes or private job data", async () => {
    jobs.push(row());
    const response = await send("post", "", input({ organizationId: "org-b" }));
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: "JOB_STAFF_CONFLICT", error: "This staff member has overlapping scheduled work." });
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE|org-|customer/);
    expect(db.job.create).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
  });
  it.each([{}, { overrideStaffConflict: false }])("does not implicitly override conflicts: %j", async (extra) => {
    jobs.push(row()); expect((await send("post", "", input(extra))).status).toBe(409);
  });
  it("allows an explicit override and atomically audits the actual conflicting jobs", async () => {
    jobs.push(row());
    expect((await send("post", "", input({ overrideStaffConflict: true }))).status).toBe(201);
    expect(jobs.at(-1)).toMatchObject({ organizationId: "org-a", assignedStaffId: "staff-a" });
    expect(audit).toHaveBeenCalledWith(db, expect.objectContaining({ action: "create.job.success",
      after: expect.objectContaining({ staffConflictOverride: true, conflictingJobIds: ["other"] }) }));
    expect(invalidate).toHaveBeenCalled();
  });
  it.each([
    ["touching before", { scheduledStart: date(8), scheduledEnd: date(10) }],
    ["touching after", { scheduledStart: date(12), scheduledEnd: date(13) }],
    ["other staff", { assignedStaffId: "staff-other" }],
    ["other tenant", { organizationId: "org-b" }],
    ["completed", { status: "COMPLETED" }], ["cancelled", { status: "CANCELLED" }],
    ["unscheduled assignment", { scheduledStart: null, scheduledEnd: null }],
    ["empty time interval", { scheduledStart: date(11), scheduledEnd: date(11) }],
  ])("allows non-conflicting work: %s", async (_label, extra) => {
    jobs.push(row(extra)); expect((await send("post", "", input())).status).toBe(201);
  });
  it.each([
    ["equal windows", { scheduledStart: date(10), scheduledEnd: date(12) }, {}],
    ["contained window", { scheduledStart: date(9), scheduledEnd: date(13) }, {}],
    ["open existing end", { scheduledStart: date(9), scheduledEnd: null }, {}],
    ["open proposed end", { scheduledStart: date(14), scheduledEnd: date(15) }, { scheduledEnd: null }],
    ["different timezone", {}, { scheduledStart: "2099-01-02T18:00:00+08:00", scheduledEnd: "2099-01-02T20:00:00+08:00" }],
  ])("warns for %s", async (_label, extra, candidate) => {
    jobs.push(row(extra)); expect((await send("post", "", input(candidate))).status).toBe(409);
  });
  it("allows unscheduled queues but warns if the staff member is currently working", async () => {
    jobs.push(row());
    expect((await send("post", "", input({ scheduledStart: null, scheduledEnd: null }))).status).toBe(201);
    jobs.push(row({ id: "working", status: "IN_PROGRESS", scheduledStart: null, scheduledEnd: null }));
    const response = await send("post", "", input({ scheduledStart: null, scheduledEnd: null }));
    expect(response.status).toBe(409); expect(response.body.error).toContain("already working");
  });
  it("warns about actual work even when its planned end is past", async () => {
    jobs.push(row({ status: "IN_PROGRESS", scheduledStart: new Date(0), scheduledEnd: new Date(1) }));
    expect((await send("post", "", input())).body.error).toContain("already working");
  });
  it("allows an empty proposed interval, while still warning about actual work", async () => {
    jobs.push(row());
    expect((await send("post", "", input({ scheduledEnd: date(10).toISOString() }))).status).toBe(201);
    jobs.push(row({ id: "working", status: "IN_PROGRESS" }));
    expect((await send("post", "", input({ scheduledEnd: date(10).toISOString() }))).status).toBe(409);
  });
  it("checks reassignment and rescheduling, excluding the edited job", async () => {
    Object.assign(jobs[0]!, { description: "Keep description", location: "Keep location", internalNotes: "Keep notes" });
    jobs.push(row());
    expect((await send("put", "/current", { assignedStaffId: "staff-a", scheduledStart: date(10), scheduledEnd: date(12) })).status).toBe(409);
    expect((await send("put", "/current", { assignedStaffId: "staff-a", scheduledStart: date(10), scheduledEnd: date(12), overrideStaffConflict: true })).status).toBe(200);
    expect(jobs[0]).toMatchObject({ description: "Keep description", location: "Keep location", internalNotes: "Keep notes" });
    expect(audit).toHaveBeenLastCalledWith(db, expect.objectContaining({ after: expect.objectContaining({ staffConflictOverride: true }) }));
    // Notes or resending an unchanged assignment do not re-prompt an acknowledged overlap.
    expect((await send("put", "/current", { internalNotes: "Updated", assignedStaffId: "staff-a" })).status).toBe(200);
    jobs = jobs.filter((job) => job.id === "current");
    expect((await send("put", "/current", { scheduledEnd: date(13) })).status).toBe(200);
    jobs.push(row({ id: "later", scheduledStart: date(13), scheduledEnd: date(15) }));
    expect((await send("put", "/current", { scheduledEnd: date(14) })).status).toBe(409);
  });
  it("checks starting work and requires a fresh override; completion never warns", async () => {
    jobs.push(row({ id: "working", assignedStaffId: "staff-other", status: "IN_PROGRESS" }));
    expect((await send("patch", "/current/status", { status: "IN_PROGRESS" })).status).toBe(409);
    expect(jobs[0]!.status).toBe("ASSIGNED"); expect(parent.status).toBe("PENDING");
    expect((await send("patch", "/current/status", { status: "IN_PROGRESS", note: "Intentional", overrideStaffConflict: true })).status).toBe(200);
    expect(jobs[0]!.status).toBe("IN_PROGRESS"); expect(parent.status).toBe("IN_PROGRESS");
    expect(audit).toHaveBeenLastCalledWith(db, expect.objectContaining({ after: { status: "IN_PROGRESS", staffConflictOverride: true, conflictingJobIds: ["working"] } }));
    expect((await send("patch", "/current/status", { status: "COMPLETED" })).status).toBe(200);
    expect(parent.status).toBe("IN_PROGRESS");
  });
  it("rechecks live conflicts for every operation, including override retries", async () => {
    expect((await send("post", "", input())).status).toBe(201);
    jobs.push(row({ id: "new-work", status: "IN_PROGRESS" }));
    expect((await send("put", "/created", { scheduledEnd: date(14) })).status).toBe(409);
    jobs.push(row({ id: "another", scheduledStart: date(13), scheduledEnd: date(15) }));
    expect((await send("put", "/created", { scheduledEnd: date(14), overrideStaffConflict: true })).status).toBe(200);
    expect(audit).toHaveBeenLastCalledWith(db, expect.objectContaining({ after: expect.objectContaining({ conflictingJobIds: ["new-work", "another"] }) }));
  });
  it("rolls back overrides if required auditing fails", async () => {
    jobs.push(row()); audit.mockRejectedValueOnce(new Error("Audit unavailable"));
    expect((await send("post", "", input({ overrideStaffConflict: true }))).status).toBe(500);
    expect(jobs.some((job) => job.id === "created")).toBe(false); expect(invalidate).not.toHaveBeenCalled();
  });
  it.each(["true", 1, null, {}])("rejects malformed override %j", async (overrideStaffConflict) => {
    expect((await send("post", "", input({ overrideStaffConflict }))).status).toBe(400);
    expect((await send("put", "/current", { assignedStaffId: "staff-a", overrideStaffConflict })).status).toBe(400);
    expect((await send("patch", "/current/status", { status: "IN_PROGRESS", overrideStaffConflict })).status).toBe(400);
  });
  it("does not allow an override-only update or bypass closed jobs, ownership or validation", async () => {
    expect((await send("put", "/current", { overrideStaffConflict: true })).status).toBe(400);
    expect((await send("post", "", input({ assignedStaffId: "foreign", overrideStaffConflict: true }))).status).toBe(404);
    expect((await send("post", "", input({ scheduledEnd: date(9), overrideStaffConflict: true }))).status).toBe(400);
    jobs[0]!.status = "COMPLETED";
    expect((await send("put", "/current", { description: "Closed", overrideStaffConflict: true })).status).toBe(409);
    expect((await send("patch", "/current/status", { status: "IN_PROGRESS", overrideStaffConflict: true })).status).toBe(409);
    parent.status = "COMPLETED";
    expect((await send("post", "", input({ overrideStaffConflict: true }))).status).toBe(409);
  });
  it("preserves authentication, tenant isolation and permissions for override requests", async () => {
    expect((await request(app).post("/jobs").send(input({ overrideStaffConflict: true }))).status).toBe(401);
    for (const actorId of ["reader", "platform"]) {
      expect((await send("post", "", input({ overrideStaffConflict: true }), actorId)).status).toBe(403);
      expect((await send("put", "/current", { assignedStaffId: "staff-a", overrideStaffConflict: true }, actorId)).status).toBe(403);
      expect((await send("patch", "/current/status", { status: "IN_PROGRESS", overrideStaffConflict: true }, actorId)).status).toBe(403);
    }
    expect((await send("put", "/current", { assignedStaffId: "staff-a", overrideStaffConflict: true }, "foreign")).status).toBe(404);
    expect((await send("patch", "/current/status", { status: "IN_PROGRESS", overrideStaffConflict: true }, "foreign")).status).toBe(404);
    sessions.writer!.userPermissions = [{ isActive: false, permission: { id: P.JOB_UPDATE, name: P.JOB_UPDATE, organizationId: null } }];
    expect((await send("patch", "/current/status", { status: "IN_PROGRESS", overrideStaffConflict: true })).status).toBe(403);
    expect(db.job.create).not.toHaveBeenCalled(); expect(db.job.update).not.toHaveBeenCalled();
  });
  it.each([ ["post", ""], ["put", "/current"], ["patch", "/current/status"] ] as const)("keeps the write limiter on %s %s", async (method, path) => {
    limited = true; const response = await send(method, path, input({ status: "IN_PROGRESS", overrideStaffConflict: true }));
    expect(response.status).toBe(429); expect(response.headers["retry-after"]).toBe("60"); expect(db.$transaction).not.toHaveBeenCalled();
  });
});
