export const statuses = ["Not Started", "In Progress", "Done"] as const;
export type Status = (typeof statuses)[number];
export interface Resource {
  id: string;
  title: string;
  url: string;
}
export interface CheckItem {
  id: string;
  text: string;
  completed: boolean;
}
export interface WorkItem {
  id: string;
  title: string;
  category: string;
  goal: string;
  status: Status;
  whereILeftOff: string;
  nextAction: string;
  checklist: CheckItem[];
  resources: Resource[];
  createdAt: string;
  updatedAt: string;
}
export type Editable = Pick<
  WorkItem,
  | "title"
  | "category"
  | "goal"
  | "status"
  | "whereILeftOff"
  | "nextAction"
  | "checklist"
  | "resources"
>;
export type Command =
  | { type: "list" }
  | { type: "create"; item: Editable }
  | { type: "patch"; id: string; patch: Partial<Editable> }
  | { type: "delete"; id: string }
  | { type: "check"; id: string; checkId: string; completed: boolean }
  | { type: "resource"; id: string; title: string; url: string };
export const STORAGE_KEY = "reentry.workItems.v1";
export function safeUrl(value: string): boolean {
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function seedItems(): WorkItem[] {
  const now = new Date().toISOString();
  return [
    {
      title: "Load Balancers",
      category: "System Design",
      goal: "Understand how to distribute traffic and design reliable services.",
      status: "In Progress" as Status,
      whereILeftOff: "Finished understanding L4 vs L7 load balancing.",
      nextAction: "Learn health checks and failure handling.",
      checklist: [
        { id: "lb-1", text: "Understand L4 vs L7", completed: true },
        {
          id: "lb-2",
          text: "Learn health checks and failure handling",
          completed: false,
        },
        {
          id: "lb-3",
          text: "Sketch a highly available setup",
          completed: false,
        },
      ],
      resources: [
        {
          id: "lb-r",
          title: "NGINX: HTTP load balancing",
          url: "https://nginx.org/en/docs/http/load_balancing.html",
        },
      ],
    },
    {
      title: "Binary Trees",
      category: "DSA",
      goal: "Build confidence solving common binary tree problems.",
      status: "In Progress" as Status,
      whereILeftOff: "Finished BFS and DFS traversals.",
      nextAction: "Solve Lowest Common Ancestor.",
      checklist: [
        { id: "bt-1", text: "Practice BFS and DFS", completed: true },
        { id: "bt-2", text: "Solve Lowest Common Ancestor", completed: false },
      ],
      resources: [
        {
          id: "bt-r",
          title: "Lowest Common Ancestor of a Binary Tree",
          url: "https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-tree/",
        },
      ],
    },
    {
      title: "Resume",
      category: "Job Search",
      goal: "Prepare a clear, focused resume for my next application.",
      status: "Not Started" as Status,
      whereILeftOff: "",
      nextAction: "Review final resume bullets.",
      checklist: [
        { id: "re-1", text: "Review final resume bullets", completed: false },
        { id: "re-2", text: "Proofread and export a PDF", completed: false },
      ],
      resources: [],
    },
  ].map((item, index) => ({
    ...item,
    id: `example-${index + 1}`,
    createdAt: now,
    updatedAt: now,
  }));
}
export function applyCommand(items: WorkItem[], command: Command): WorkItem[] {
  const now = new Date().toISOString();
  if (command.type === "list") return items;
  if (command.type === "create") {
    validate(command.item);
    return [
      ...items,
      {
        ...command.item,
        title: command.item.title.trim(),
        category: command.item.category.trim(),
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
  if (!items.some((item) => item.id === command.id))
    throw new Error(
      "This work item no longer exists. Return to your work and try again.",
    );
  if (command.type === "delete")
    return items.filter((item) => item.id !== command.id);
  return items.map((item) => {
    if (item.id !== command.id) return item;
    let next = { ...item, updatedAt: now };
    if (command.type === "patch") next = { ...next, ...command.patch };
    if (command.type === "check")
      next.checklist = item.checklist.map((check) =>
        check.id === command.checkId
          ? { ...check, completed: command.completed }
          : check,
      );
    if (command.type === "resource") {
      if (!safeUrl(command.url))
        throw new Error("Only http and https pages can be saved.");
      if (item.resources.some((resource) => resource.url === command.url))
        return item;
      next.resources = [
        ...item.resources,
        {
          id: crypto.randomUUID(),
          title: command.title.trim() || command.url,
          url: command.url,
        },
      ];
    }
    validate(next);
    return next;
  });
}
function validate(item: Editable) {
  if (!item.title.trim() || !item.category.trim())
    throw new Error("Add a title and category.");
  if (!statuses.includes(item.status))
    throw new Error("Choose a valid status.");
  if (item.resources.some((resource) => !safeUrl(resource.url)))
    throw new Error("Resources must have valid http or https URLs.");
}
