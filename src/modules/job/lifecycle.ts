import type { JobStatus } from "@/generated/prisma/client.js";
import { AppError } from "@/utils/AppError.js";

export function checkJobTransition(from: JobStatus, to: JobStatus) {
  const transitions: Record<JobStatus, JobStatus[]> = {
    ASSIGNED: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED", "CANCELLED"], COMPLETED: [], CANCELLED: [],
  };
  if (!transitions[from].includes(to)) throw new AppError(409, "Invalid job status transition");
}
