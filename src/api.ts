import type { Command, Editable, Status, WorkItem } from "./model";
const toWire = {
  "In Progress": "IN_PROGRESS",
  "Not Started": "NOT_STARTED",
  Done: "DONE",
} as const;
const fromWire: Record<string, Status> = {
  IN_PROGRESS: "In Progress",
  NOT_STARTED: "Not Started",
  DONE: "Done",
};
export interface User {
  id: string;
  email: string;
}
export interface Session {
  user: User;
  token: string;
  expiresAt: string;
}
export interface SessionView {
  user: User | null;
  migrationCount: number;
  warning?: string;
}
export type AuthCommand =
  | { type: "session" }
  | { type: "login" | "register"; email: string; password: string }
  | { type: "logout" }
  | { type: "migrate" };
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export function apiUrl() {
  return (import.meta.env?.VITE_API_URL || "http://localhost:3001/api").replace(
    /\/$/,
    "",
  );
}
export function apiTimeoutMs() {
  const value = Number(import.meta.env?.VITE_API_TIMEOUT_MS || 20000);
  return Number.isFinite(value) && value >= 20000 && value <= 120000
    ? value
    : 20000;
}
export async function apiFetch<T>(
  path: string,
  token?: string,
  method = "GET",
  body?: unknown,
  requestId?: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), apiTimeoutMs());
  try {
    const response = await fetch(`${apiUrl()}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(requestId ? { "Idempotency-Key": requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => null)) as {
      error?: string;
      details?: { path: string; message: string }[];
    } | null;
    if (!response.ok)
      throw new ApiError(
        [
          data?.error ||
            (
              {
                401: "Your session expired. Please log in again.",
                403: "This extension is not allowed to connect. Check the server's allowed origins.",
                404: "This item or endpoint is no longer available. Refresh and try again.",
                429: "Too many requests. Wait a minute before retrying.",
              } as Record<number, string>
            )[response.status] ||
            "The server could not complete this request. Try again.",
          ...(Array.isArray(data?.details)
            ? data.details.map((d) => `${d.path}: ${d.message}`)
            : []),
        ].join(" "),
        response.status,
      );
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new ApiError(
        "ReEntry returned an invalid response. The change could not be confirmed; refresh before retrying.",
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "Cannot reach ReEntry. The server may be waking up or your connection may be offline. Try again. A submitted change may have reached the server; refresh before repeating it.",
    );
  } finally {
    clearTimeout(timer);
  }
}
function payload(input: Partial<Editable>) {
  return {
    ...input,
    ...(input.status ? { status: toWire[input.status] } : {}),
  };
}
export function migrationPayload(sourceId: string, items: WorkItem[]) {
  return {
    sourceId,
    items: items.map((item) => ({ ...item, status: toWire[item.status] })),
  };
}
export async function executeApiCommand(
  command: Command,
  token: string,
): Promise<WorkItem[]> {
  if (command.type === "list") {
    const data = await apiFetch<{
      items: (Omit<WorkItem, "status"> & { status: string })[];
    }>("/work-items", token);
    return data.items.map((item) => ({
      ...item,
      status: fromWire[item.status],
      checklist: item.checklist.map(({ id, text, completed }) => ({
        id,
        text,
        completed,
      })),
      resources: item.resources.map(({ id, title, url, source }) => ({
        id,
        title,
        url,
        source: source ?? "MANUAL",
      })),
    }));
  }
  if (command.type === "create") {
    const result = await apiFetch<{ item?: { id?: string } }>(
      "/work-items",
      token,
      "POST",
      payload(command.item),
      command.requestId,
    );
    if (!result?.item?.id)
      throw new ApiError(
        "The saved work item could not be confirmed. Refresh before retrying.",
      );
  }
  if (command.type === "patch") {
    if (Object.keys(command.patch).length)
      await apiFetch(
        `/work-items/${encodeURIComponent(command.id)}`,
        token,
        "PATCH",
        payload(command.patch),
      );
  }
  if (command.type === "delete")
    await apiFetch(
      `/work-items/${encodeURIComponent(command.id)}`,
      token,
      "DELETE",
    );
  if (command.type === "check")
    await apiFetch(
      `/work-items/${encodeURIComponent(command.id)}/checklist/${encodeURIComponent(command.checkId)}`,
      token,
      "PATCH",
      { completed: command.completed },
    );
  if (command.type === "resource")
    await apiFetch(
      `/work-items/${encodeURIComponent(command.id)}/resources`,
      token,
      "POST",
      { title: command.title, url: command.url },
    );
  if (command.type === "workspace")
    await apiFetch(
      `/work-items/${encodeURIComponent(command.id)}/resources/bulk`,
      token,
      "POST",
      { resources: command.resources },
    );
  if (command.type === "remove-resource")
    await apiFetch(
      `/resources/${encodeURIComponent(command.resourceId)}`,
      token,
      "DELETE",
    );
  if (command.type === "checkpoint") {
    const result = await apiFetch<{ checkpoint?: { id?: string } }>(
      `/work-items/${encodeURIComponent(command.id)}/checkpoints`,
      token,
      "POST",
      command.input,
    );
    if (!result?.checkpoint?.id)
      throw new ApiError(
        "Checkpoint save could not be confirmed. Retry this draft to check the saved attempt.",
      );
  }
  return [];
}
