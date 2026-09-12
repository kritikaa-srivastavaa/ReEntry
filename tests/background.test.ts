import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { STORAGE_KEY, seedItems } from "../src/model";
import {
  createSessionService,
  MIGRATION_KEY,
  SESSION_KEY,
} from "../src/session-service";
import { migrationPayload } from "../src/api";

test("API bridge keeps tokens private, retries migration safely and clears expired sessions", async () => {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  const legacy = seedItems();
  const saved: Record<string, unknown> = {
    [STORAGE_KEY]: structuredClone(legacy),
  };
  const receipts = new Set<string>();
  let apiDown = false,
    expired = false,
    failMarker = false,
    importedCount = 0,
    events = 0;
  const storage = {
    async get(keys: string | string[]) {
      return structuredClone(
        Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).map((k) => [k, saved[k]]),
        ),
      );
    },
    async set(values: Record<string, unknown>) {
      if (
        failMarker &&
        (values[MIGRATION_KEY] as { completedBy?: string })?.completedBy
      ) {
        failMarker = false;
        throw new Error("Local write failed");
      }
      Object.assign(saved, structuredClone(values));
    },
    async remove(key: string) {
      delete saved[key];
    },
  } as Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (apiDown) throw new Error("Network unavailable");
    const path = String(url);
    if (path.endsWith("/auth/login"))
      return new Response(
        JSON.stringify({
          token: "private-token",
          user: { id: "alice", email: "alice@example.com" },
          expiresAt: "2030-01-01T00:00:00.000Z",
        }),
      );
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer private-token",
    );
    if (expired)
      return new Response(JSON.stringify({ error: "Expired" }), {
        status: 401,
      });
    if (path.endsWith("/auth/me"))
      return new Response(
        JSON.stringify({ user: { id: "alice", email: "alice@example.com" } }),
      );
    if (path.endsWith("/auth/logout"))
      return new Response(null, { status: 204 });
    if (path.endsWith("/work-items/import")) {
      const body = JSON.parse(init!.body as string) as ReturnType<
        typeof migrationPayload
      >;
      for (const item of body.items) {
        const key = `${body.sourceId}:${item.id}`;
        if (!receipts.has(key)) {
          receipts.add(key);
          importedCount++;
        }
      }
      return new Response(JSON.stringify({ imported: 3 }));
    }
    if (path.endsWith("/work-items"))
      return new Response(
        JSON.stringify({ items: [{ ...legacy[0], status: "IN_PROGRESS" }] }),
      );
    return new Response(null, { status: 204 });
  };
  try {
    const service = createSessionService(storage, () => events++);
    assert.equal((await service.auth({ type: "session" })).user, null);
    await assert.rejects(service.work({ type: "list" }), /Log in/);
    const session = await service.auth({
      type: "login",
      email: "alice@example.com",
      password: "not-in-views",
    });
    assert.equal(session.migrationCount, 3);
    assert.equal("token" in session, false);
    assert.equal(
      (await service.work({ type: "list" }))[0].status,
      "In Progress",
    );
    await service.work({
      type: "patch",
      id: legacy[0].id,
      patch: { nextAction: "Changed on server" },
    });
    assert.deepEqual(saved[STORAGE_KEY], legacy);
    apiDown = true;
    await assert.rejects(service.auth({ type: "migrate" }), /Cannot reach/);
    const sourceId = (saved[MIGRATION_KEY] as { sourceId: string }).sourceId;
    assert.ok(sourceId);
    assert.equal(importedCount, 0);
    apiDown = false;
    failMarker = true;
    await assert.rejects(
      service.auth({ type: "migrate" }),
      /Local write failed/,
    );
    assert.equal(importedCount, 3);
    const done = await service.auth({ type: "migrate" });
    assert.equal(done.migrationCount, 0);
    assert.equal(importedCount, 3);
    assert.equal(
      (saved[MIGRATION_KEY] as { sourceId: string }).sourceId,
      sourceId,
    );
    assert.deepEqual(saved[STORAGE_KEY], legacy);
    const restarted = createSessionService(storage, () => events++);
    assert.equal((await restarted.auth({ type: "session" })).user?.id, "alice");
    expired = true;
    await assert.rejects(restarted.work({ type: "list" }), /Expired/);
    assert.equal(saved[SESSION_KEY], undefined);
    expired = false;
    await service.auth({
      type: "login",
      email: "alice@example.com",
      password: "not-in-views",
    });
    apiDown = true;
    const loggedOut = await service.auth({ type: "logout" });
    assert.equal(loggedOut.user, null);
    assert.match(loggedOut.warning!, /could not confirm/);
    assert.equal(saved[SESSION_KEY], undefined);
    assert.ok(events >= 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker starts without setAccessLevel, answers session requests, and preserves capture", async () => {
  let receive: Parameters<
    typeof chrome.runtime.onMessage.addListener
  >[0] = () => {};
  let clicked: (
    info: chrome.contextMenus.OnClickData,
    tab: chrome.tabs.Tab,
  ) => void = () => {};
  let destination = "";
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        id: "test",
        getURL: (path: string) => `chrome-extension://test/${path}`,
        sendMessage: async () => {},
        onMessage: {
          addListener(fn: typeof receive) {
            receive = fn;
          },
        },
        onInstalled: { addListener() {} },
      },
      storage: {
        // Reproduce the user's browser: this method is absent, not a stub.
        local: { get: async () => ({}) },
      },
      contextMenus: {
        onClicked: {
          addListener(fn: typeof clicked) {
            clicked = fn;
          },
        },
      },
      tabs: {
        create: async ({ url }: { url: string }) => {
          destination = url;
        },
      },
    },
  });
  await import("../src/background");
  const session = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Worker did not answer session request")),
      1000,
    );
    const held = receive(
      { channel: "reentry-auth", command: { type: "session" } },
      { id: "test", url: "chrome-extension://test/popup.html" },
      (reply) => {
        clearTimeout(timer);
        resolve(reply);
      },
    );
    assert.equal(held, true);
  });
  assert.deepEqual(session, {
    session: { user: null, migrationCount: 0, warning: undefined },
  });
  clicked(
    {
      menuItemId: "save-reentry",
      pageUrl: "https://example.com/notes",
    } as chrome.contextMenus.OnClickData,
    { title: "Study notes" } as chrome.tabs.Tab,
  );
  const url = new URL(destination);
  assert.equal(url.searchParams.get("saveTitle"), "Study notes");
  assert.equal(url.searchParams.get("saveUrl"), "https://example.com/notes");
});
