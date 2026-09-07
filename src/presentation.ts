import type { Status, WorkItem } from "./model";

// Presentation only: persisted status values and storage operations stay unchanged.
export const statusPresentation = {
  "In Progress": { order: 0, className: "status-progress" },
  "Not Started": { order: 1, className: "status-not-started" },
  Done: { order: 2, className: "status-done" },
} satisfies Record<Status, { order: number; className: string }>;

export const displayStatuses = (
  Object.keys(statusPresentation) as Status[]
).sort((a, b) => statusPresentation[a].order - statusPresentation[b].order);

export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  return (
    statusPresentation[a.status].order - statusPresentation[b.status].order ||
    Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
}
