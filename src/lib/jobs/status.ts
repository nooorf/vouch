export type JobStatus = "DRAFT" | "PROPOSED" | "AGREED" | "FUNDED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "EXPIRED";

/** Every allowed job status change. Anything else is a bug and is refused. */
const ALLOWED: Record<JobStatus, JobStatus[]> = {
  DRAFT: ["PROPOSED", "CANCELLED"],
  PROPOSED: ["AGREED", "DRAFT", "CANCELLED"], // DRAFT: the client asked for changes
  AGREED: ["FUNDED", "EXPIRED", "CANCELLED"],
  FUNDED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new Error(`Job cannot move from ${from} to ${to}`);
}

/** The steps shown on the job timeline, in order. */
export const STEPS = [
  { key: "draft", label: "Brief drafted" },
  { key: "sent", label: "Sent to client" },
  { key: "agreed", label: "Agreed" },
  { key: "funded", label: "Funded" },
  { key: "delivering", label: "Delivering" },
  { key: "done", label: "Completed" },
] as const;

/** Index of the current step on the timeline (steps before it are done). */
export function stepIndex(status: JobStatus): number {
  switch (status) {
    case "DRAFT":
      return 0;
    case "PROPOSED":
      return 1;
    case "AGREED":
      return 2;
    case "FUNDED":
      return 3;
    case "IN_PROGRESS":
      return 4;
    case "COMPLETED":
      return 5;
    default:
      return -1;
  }
}
