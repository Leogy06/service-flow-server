import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/utils/AppError";

/** Runs against live data inside the same serializable transaction as the write. */
export async function checkStaffConflicts(
  db: Prisma.TransactionClient,
  input: {
    organizationId: string;
    assignedStaffId: string;
    jobId?: string;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    overrideStaffConflict?: boolean;
  },
) {
  const { organizationId, assignedStaffId, jobId, scheduledStart, scheduledEnd } = input;
  const candidates = await db.job.findMany({
    where: {
      organizationId,
      assignedStaffId,
      ...(jobId ? { id: { not: jobId } } : {}),
      OR: [
        // Actual work stays busy even when its scheduled end has elapsed.
        { status: "IN_PROGRESS" },
        ...(scheduledStart && (!scheduledEnd || scheduledEnd > scheduledStart) ? [{
          status: "ASSIGNED" as const,
          scheduledStart: { not: null, ...(scheduledEnd ? { lt: scheduledEnd } : {}) },
          OR: [{ scheduledEnd: null }, { scheduledEnd: { gt: scheduledStart } }],
        }] : []),
      ],
    },
    select: { id: true, status: true, scheduledStart: true, scheduledEnd: true },
  });
  // Existing schemas permit equal endpoints. Empty intervals reserve no time.
  const conflicts = candidates.filter((job) => job.status === "IN_PROGRESS" ||
    !job.scheduledEnd || !!job.scheduledStart && job.scheduledEnd > job.scheduledStart);
  if (conflicts.length && !input.overrideStaffConflict) {
    const working = conflicts.some((job) => job.status === "IN_PROGRESS");
    const scheduled = conflicts.some((job) => job.status === "ASSIGNED");
    const reason = working && scheduled
      ? "This staff member is already working on another job and has overlapping scheduled work."
      : working
        ? "This staff member is already working on another job."
        : "This staff member has overlapping scheduled work.";
    // Availability warnings do not disclose other jobs, customers or notes to writers.
    throw new AppError(409, reason, "JOB_STAFF_CONFLICT");
  }
  return conflicts.length ? { staffConflictOverride: true, conflictingJobIds: conflicts.map((job) => job.id) } : {};
}
