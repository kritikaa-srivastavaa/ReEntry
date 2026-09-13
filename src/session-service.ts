import {
  ApiError,
  apiFetch,
  apiUrl,
  executeApiCommand,
  migrationPayload,
  type AuthCommand,
  type Session,
  type SessionView,
} from "./api";
import { STORAGE_KEY, type Command, type WorkItem } from "./model";
export const SESSION_KEY = "reentry.session.v2";
export const MIGRATION_KEY = "reentry.migration.v2";
export const MIGRATION_OWNER_KEY = "reentry.migration.owner.v2";
interface MigrationState {
  sourceId: string;
  completedBy?: string;
}
// Local storage is used only for session state and retained V1 migration input.
export function createSessionService(
  storage: Pick<chrome.storage.StorageArea, "get" | "set" | "remove">,
  changed: () => void,
  storageScope = apiUrl(),
) {
  // Keep existing local sessions compatible, but never carry a local login or
  // migration-complete marker into a different hosted database.
  const endpoint = storageScope;
  const local = ["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname);
  const sessionKey = local ? SESSION_KEY : `${SESSION_KEY}:${endpoint}`;
  const migrationKey = local ? MIGRATION_KEY : `${MIGRATION_KEY}:${endpoint}`;
  async function migrationOwner() {
    const stored = await storage.get([
      MIGRATION_OWNER_KEY,
      MIGRATION_KEY,
      migrationKey,
    ]);
    const claim = stored[MIGRATION_OWNER_KEY] as
      | { sourceId: string; ownerId: string }
      | undefined;
    if (claim) return claim;
    // Older versions recorded completion per API. Preserve that ownership
    // when switching to the hosted database or logging into another account.
    const completed = [stored[MIGRATION_KEY], stored[migrationKey]].find(
      (state: MigrationState | undefined) => state?.completedBy,
    ) as MigrationState | undefined;
    return completed?.completedBy
      ? { sourceId: completed.sourceId, ownerId: completed.completedBy }
      : undefined;
  }
  const session = async () =>
    (await storage.get(sessionKey))[sessionKey] as Session | undefined;
  async function clearSession() {
    await storage.remove(sessionKey);
    changed();
  }
  async function view(
    saved: Session | undefined,
    warning?: string,
  ): Promise<SessionView> {
    if (!saved) return { user: null, migrationCount: 0, warning };
    const local = await storage.get([STORAGE_KEY, migrationKey]);
    const legacy = local[STORAGE_KEY] as WorkItem[] | undefined;
    const migration = local[migrationKey] as MigrationState | undefined;
    const owner = await migrationOwner();
    return {
      user: saved.user,
      migrationCount:
        migration?.completedBy || (owner && owner.ownerId !== saved.user.id)
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
      await storage.set({ [sessionKey]: saved });
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
    const local = await storage.get([STORAGE_KEY, migrationKey]);
    const items = local[STORAGE_KEY] as WorkItem[] | undefined;
    let state = local[migrationKey] as MigrationState | undefined;
    const owner = await migrationOwner();
    if (owner && owner.ownerId !== saved.user.id) return view(saved);
    if (state?.completedBy || !Array.isArray(items) || !items.length)
      return view(saved);
    if (!state) {
      // A database transfer preserves server import receipts. Reuse the source
      // identity across endpoints, but never copy the local completion flag.
      const previous = (await storage.get(MIGRATION_KEY))[MIGRATION_KEY] as
        | MigrationState
        | undefined;
      const sourceId =
        typeof previous?.sourceId === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          previous.sourceId,
        )
          ? previous.sourceId
          : owner?.sourceId
            ? owner.sourceId
            : crypto.randomUUID();
      state = { sourceId };
      await storage.set({ [migrationKey]: state });
    }
    // Bind the retained source before uploading, including partial/failed imports.
    // Another account must never be offered this account's local backup.
    await storage.set({
      [MIGRATION_OWNER_KEY]: {
        sourceId: state.sourceId,
        ownerId: saved.user.id,
      },
    });
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
      [migrationKey]: { ...state, completedBy: saved.user.id },
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
