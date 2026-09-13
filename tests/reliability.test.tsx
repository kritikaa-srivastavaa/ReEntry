import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ApiError, apiFetch } from "../src/api";

test("HTTP failures and malformed success responses never become successful saves", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 404, 429, 500]) {
      globalThis.fetch = async () =>
        new Response("<html>Unavailable</html>", { status });
      await assert.rejects(
        apiFetch("/work-items"),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === status &&
          !error.message.includes("<html>"),
      );
    }
    for (const body of ["not-json", "null", "[]"]) {
      globalThis.fetch = async () => new Response(body);
      await assert.rejects(
        apiFetch("/work-items", "test", "POST", {}),
        /invalid response/,
      );
    }
    globalThis.fetch = async () => {
      throw new TypeError("Network down");
    };
    await assert.rejects(apiFetch("/work-items"), /Cannot reach ReEntry/);
  } finally {
    globalThis.fetch = original;
  }
});

test("slow refreshes are coalesced and an invalidation triggers one follow-up", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://extension.test/workspace.html",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const listeners = new Set<(m: { channel: string }) => void>();
  const replies: ((result: unknown) => void)[] = [];
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        id: "test",
        onMessage: {
          addListener: (f: (m: { channel: string }) => void) =>
            listeners.add(f),
          removeListener: (f: (m: { channel: string }) => void) =>
            listeners.delete(f),
        },
        sendMessage: () => new Promise((resolve) => replies.push(resolve)),
      },
    },
  });
  const { renderHook, act, waitFor, cleanup } = await import(
    "@testing-library/react"
  );
  const { useWorkItems } = await import("../src/storage");
  try {
    const { result } = renderHook(useWorkItems);
    assert.equal(replies.length, 1);
    act(() => {
      for (let i = 0; i < 5; i++) {
        window.dispatchEvent(new dom.window.Event("focus"));
        listeners.forEach((f) => f({ channel: "reentry-update" }));
      }
    });
    assert.equal(replies.length, 1);
    await act(async () =>
      replies[0]({ items: [{ id: "old", nextAction: "Study caching" }] }),
    );
    await waitFor(() => assert.equal(replies.length, 2));
    assert.equal(result.current.loading, false);
    await act(async () =>
      replies[1]({ items: [{ id: "old", nextAction: "Study CDN" }] }),
    );
    assert.equal(result.current.items[0].nextAction, "Study CDN");
    assert.equal(replies.length, 2);
  } finally {
    cleanup();
    dom.window.close();
  }
});
