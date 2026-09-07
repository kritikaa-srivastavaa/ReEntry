import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { STORAGE_KEY, type Command, type WorkItem } from "../src/model";

test("service worker serializes concurrent writes, persists empty state, and handles failures", async () => {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  let stored: Record<string, unknown> = {};
  let handler: (
    message: unknown,
    sender: unknown,
    respond: (value: { items?: WorkItem[]; error?: string }) => void,
  ) => void;
  let failNextWrite = false;
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        id: "test-extension",
        onMessage: {
          addListener: (fn: typeof handler) => {
            handler = fn;
          },
        },
        onInstalled: { addListener() {} },
      },
      storage: {
        local: {
          async get() {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return structuredClone(stored);
          },
          async set(value: Record<string, unknown>) {
            if (failNextWrite) {
              failNextWrite = false;
              throw new Error("Storage quota exceeded");
            }
            stored = structuredClone(value);
          },
        },
      },
      contextMenus: { onClicked: { addListener() {} } },
    },
  });
  await import("../src/background");
  const send = (command: Command) =>
    new Promise<{ items?: WorkItem[]; error?: string }>((resolve) =>
      handler(
        { channel: "reentry", command },
        { id: "test-extension" },
        resolve,
      ),
    );
  const initial = await send({ type: "list" });
  assert.equal(initial.items?.length, 3);
  const id = initial.items![0].id;
  await Promise.all([
    send({ type: "patch", id, patch: { nextAction: "Persist this context" } }),
    send({ type: "resource", id, title: "Extra", url: "https://example.com/" }),
    send({ type: "check", id, checkId: "lb-2", completed: true }),
  ]);
  const final = (await send({ type: "list" })).items![0];
  assert.equal(final.nextAction, "Persist this context");
  assert.equal(final.resources.length, 2);
  assert.equal(final.checklist[1].completed, true);
  failNextWrite = true;
  assert.match(
    (await send({ type: "patch", id, patch: { title: "Unsaved" } })).error!,
    /quota/,
  );
  assert.equal((await send({ type: "list" })).items![0].title, final.title);
  for (const item of initial.items!)
    await send({ type: "delete", id: item.id });
  assert.deepEqual(stored[STORAGE_KEY], []);
  assert.deepEqual((await send({ type: "list" })).items, []);
});
