import type { AuthCommand, SessionView } from "./api";
import { apiTimeoutMs } from "./api";
import type { Command, WorkItem } from "./model";
import { createSessionService } from "./session-service";
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((fn) => fn());
}
const memory: Record<string, unknown> = {};
// Browser dev dashboard: session in memory only. Installed views use the worker.
const devStorage = {
  async get(keys: string | string[]) {
    return Object.fromEntries(
      (Array.isArray(keys) ? keys : [keys]).map((key) => [key, memory[key]]),
    );
  },
  async set(values: Record<string, unknown>) {
    Object.assign(memory, values);
  },
  async remove(key: string) {
    delete memory[key];
  },
} as Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;
const devService = createSessionService(devStorage, notify);
let devQueue: Promise<unknown> = Promise.resolve();
async function timeoutDetails(): Promise<string> {
  if (!globalThis.chrome?.runtime?.id)
    return "The browser API request is stalled.";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      chrome.runtime.sendMessage({ channel: "reentry-diagnostic" }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("No reply")), 2000);
      }),
    ]);
    const states = [
      "initializing storage access",
      "storage initialization failed",
      "waiting for API or extension storage",
      "ready",
    ];
    return states.includes(result?.workerState)
      ? `Background status: ${result.workerState}. Extension ID: ${chrome.runtime.id}.`
      : `The loaded background script is outdated. Extension ID: ${chrome.runtime.id}.`;
  } catch {
    return `Chrome's background script did not answer. Open chrome://extensions → ReEntry → Errors and report the error. Extension ID: ${chrome.runtime.id}.`;
  } finally {
    clearTimeout(timer);
  }
}
async function send(channel: string, command: Command | AuthCommand) {
  if (!globalThis.chrome?.runtime?.id) {
    const task = devQueue.then(async () =>
      channel === "reentry-auth"
        ? { session: await devService.auth(command as AuthCommand) }
        : { items: await devService.work(command as Command) },
    );
    devQueue = task.catch(() => undefined);
    return task;
  }
  const response = await chrome.runtime.sendMessage({ channel, command });
  if (!response || response.error)
    throw new Error(
      response?.error ||
        "ReEntry did not respond. Reload the extension and retry.",
    );
  return response;
}
export async function request(command: Command): Promise<WorkItem[]> {
  return (await send("reentry", command)).items;
}
export async function authRequest(command: AuthCommand): Promise<SessionView> {
  // A stopped/outdated extension worker may never answer. Bound session discovery
  // independently of fetch's timeout, which cannot cover the message bridge.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const operation = send("reentry-auth", command);
    const response =
      command.type !== "migrate"
        ? await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => {
                  void timeoutDetails().then((details) =>
                    reject(
                      new Error(
                        `${command.type === "session" ? "Session check timed out." : "ReEntry did not respond in time."} ${details}`,
                      ),
                    ),
                  );
                },
                command.type === "session"
                  ? apiTimeoutMs() + 5000
                  : apiTimeoutMs() * 2 + 5000,
              );
            }),
          ])
        : await operation;
    const session = response.session;
    if (
      !session ||
      !("user" in session) ||
      typeof session.migrationCount !== "number"
    ) {
      throw new Error(
        "ReEntry returned an incompatible session response. Reload the extension at chrome://extensions and reopen it.",
      );
    }
    return session;
  } finally {
    clearTimeout(timer);
  }
}
export function subscribe(listener: () => void) {
  const message = (value: { channel?: string }) => {
    if (value.channel === "reentry-update") listener();
  };
  listeners.add(listener);
  globalThis.chrome?.runtime?.onMessage?.addListener(message);
  return () => {
    listeners.delete(listener);
    globalThis.chrome?.runtime?.onMessage?.removeListener(message);
  };
}
