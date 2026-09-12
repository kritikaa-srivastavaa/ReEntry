import {
  ApiError,
  apiFetch,
  executeApiCommand,
  migrationPayload,
  type AuthCommand,
  type Session,
  type SessionView,
} from "./api";
import { STORAGE_KEY, type Command, type WorkItem } from "./model";
export const SESSION_KEY = "reentry.session.v2";
export const MIGRATION_KEY = "reentry.migration.v2";
interface MigrationState {
  sourceId: string;
  completedBy?: string;
}
// Local storage is used only for session state and retained V1 migration input.
export function createSessionService(
  storage: Pick<chrome.storage.StorageArea, "get" | "set" | "remove">,
  changed: () => void,
) {
  const session = async () =>
    (await storage.get(SESSION_KEY))[SESSION_KEY] as Session | undefined;
  async function clearSession() {
    await storage.remove(SESSION_KEY);
    changed();
  }
  async function view(
    saved: Session | undefined,
    warning?: string,
  ): Promise<SessionView> {
    if (!saved) return { user: null, migrationCount: 0, warning };
    const local = await storage.get([STORAGE_KEY, MIGRATION_KEY]);
    const legacy = local[STORAGE_KEY] as WorkItem[] | undefined;
    const migration = local[MIGRATION_KEY] as MigrationState | undefined;
    return {
      user: saved.user,
      migrationCount: migration?.completedBy
        ? 0
        : Array.isArray(legacy)
          ? legacy.length
          : 0,
      warning,
    };
  }
  async function requireSession() {
    const saved = await session();
    if (!saved) throw new ApiError("Log in to continue.", 401);
    return saved;
  }
  async function auth(command: AuthCommand): Promise<SessionView> {
    if (command.type === "login" || command.type === "register") {
      const saved = await apiFetch<Session>(
        `/auth/${command.type}`,
        undefined,
        "POST",
        { email: command.email, password: command.password },
      );
      await storage.set({ [SESSION_KEY]: saved });
      changed();
      return view(saved);
    }
    if (command.type === "logout") {
      const saved = await session();
      let warning: string | undefined;
      try {
        if (saved) await apiFetch("/auth/logout", saved.token, "POST");
      } catch {
        warning =
          "Logged out on this device. The server could not confirm revocation; that session will expire automatically.";
      }
      await clearSession();
      return view(undefined, warning);
    }
    const saved = await session();
    if (!saved) return view(undefined);
    if (command.type === "session") {
      const { user } = await apiFetch<{ user: Session["user"] }>(
        "/auth/me",
        saved.token,
      );
      return view({ ...saved, user });
    }
    const local = await storage.get([STORAGE_KEY, MIGRATION_KEY]);
    const items = local[STORAGE_KEY] as WorkItem[] | undefined;
    let state = local[MIGRATION_KEY] as MigrationState | undefined;
    if (state?.completedBy || !Array.isArray(items) || !items.length)
      return view(saved);
    if (!state) {
      state = { sourceId: crypto.randomUUID() };
      await storage.set({ [MIGRATION_KEY]: state });
    }
    // Persist source ID before uploading. PostgreSQL receipts make retries safe after interruption.
    for (let offset = 0; offset < items.length; offset += 50) {
      await apiFetch(
        "/work-items/import",
        saved.token,
        "POST",
        migrationPayload(state.sourceId, items.slice(offset, offset + 50)),
      );
    }
    await storage.set({
      [MIGRATION_KEY]: { ...state, completedBy: saved.user.id },
    });
    changed();
    return view(saved);
  }
  async function run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        await clearSession();
      throw error;
    }
  }
  return {
    auth: (command: AuthCommand) => run(() => auth(command)),
    work: (command: Command) =>
      run(async () => {
        const saved = await requireSession();
        const result = await executeApiCommand(command, saved.token);
        if (command.type !== "list") changed();
        return result;
      }),
  };
}
