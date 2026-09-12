export interface AuthDraft {
  mode: "login" | "register";
  email: string;
  password: string;
  confirmation: string;
}

const key = "reentry.auth-draft.v2";
let memory: AuthDraft | undefined;
let pending: Promise<unknown> = Promise.resolve();

// Chrome session storage is memory-only and restricted to trusted extension
// contexts by default. Draft passwords never enter local storage or the API.
export async function readAuthDraft(): Promise<AuthDraft | undefined> {
  await pending;
  const storage = globalThis.chrome?.storage?.session;
  return storage ? (await storage.get(key))[key] : memory;
}

export function saveAuthDraft(draft?: AuthDraft): Promise<void> {
  memory = draft;
  const task = pending.then(async () => {
    const storage = globalThis.chrome?.storage?.session;
    if (!storage) return;
    if (draft) await storage.set({ [key]: draft });
    else await storage.remove(key);
  });
  pending = task.catch(() => undefined);
  return task;
}
