import type { ServiceRequestStatus, JobStatus } from "@/generated/prisma/client.js";
import { AppError } from "@/utils/AppError.js";

export const requestTransitions: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
  PENDING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function validateTransition(from: ServiceRequestStatus, to: ServiceRequestStatus, jobs: { status: JobStatus }[]) {
  if (!requestTransitions[from].includes(to)) throw new AppError(409, "Invalid request status transition");
  if (to === "COMPLETED" && (!jobs.length || jobs.some((job) => job.status !== "COMPLETED"))) {
    throw new AppError(409, "Complete every related job before completing the request; at least one job is required");
  }
  if (to === "CANCELLED" && jobs.some((job) => job.status !== "COMPLETED" && job.status !== "CANCELLED")) {
    throw new AppError(409, "Complete or cancel active jobs before cancelling the request");
  }
}
