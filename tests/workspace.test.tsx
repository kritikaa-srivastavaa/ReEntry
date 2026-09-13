import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import React from "react";
import { executeApiCommand } from "../src/api";
import { createSessionService, SESSION_KEY } from "../src/session-service";
import { JSDOM } from "jsdom";
import {
  currentWorkspaceTabs,
  resumeWorkspace,
  selectableTabs,
} from "../src/browser-workspace";
import {
  seedItems,
  type Command,
  type HistoryCommand,
  type WorkCheckpoint,
} from "../src/model";

const tabs = [
  {
    id: 1,
    index: 0,
    windowId: 7,
    title: "Primer",
    url: "https://EXAMPLE.com:443",
  },
  {
    id: 2,
    index: 1,
    windowId: 7,
    title: "Lecture",
    url: "https://video.example/watch?t=42",
  },
  {
    id: 3,
    index: 2,
    windowId: 7,
    title: "Docs",
    url: "https://docs.example/guide#section",
  },
  { id: 4, index: 3, windowId: 7, url: "chrome://settings" },
  { id: 5, index: 4, windowId: 7, url: "https://example.com/" },
] as chrome.tabs.Tab[];

test("V3 API bridge preserves resource source and keeps checkpoint reads authenticated", async () => {
  const original = globalThis.fetch;
  const calls: { path: string; method: string; body: unknown }[] = [];
  const item = seedItems()[0];
  let expired = false;
  const state: Record<string, unknown> = {
    [SESSION_KEY]: {
      token: "private-test-token",
      user: { id: "alice", email: "alice@example.com" },
    },
  };
  const storage = {
    get: async (keys: string | string[]) =>
      Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys]).map((key) => [key, state[key]]),
      ),
    set: async (values: Record<string, unknown>) => {
      Object.assign(state, values);
    },
    remove: async (key: string) => {
      delete state[key];
    },
  } as Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;
  globalThis.fetch = async (url, init) => {
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer private-test-token",
    );
    const path = new URL(String(url)).pathname;
    calls.push({
      path,
      method: init?.method || "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (expired)
      return new Response(JSON.stringify({ error: "Session expired" }), {
        status: 401,
      });
    if (path.endsWith("/checkpoints"))
      return new Response(
        JSON.stringify(
          init?.method === "POST"
            ? { checkpoint: { id: "checkpoint-id" } }
            : { checkpoints: [], hasMore: false },
        ),
      );
    if (path.endsWith("/work-items"))
      return new Response(
        JSON.stringify({
          items: [
            {
              ...item,
              status: "IN_PROGRESS",
              resources: [{ ...item.resources[0], source: "WORKSPACE" }],
            },
          ],
        }),
      );
    return new Response(null, { status: 204 });
  };
  try {
    const token = "private-test-token";
    const result = await executeApiCommand({ type: "list" }, token);
    assert.equal(result[0].resources[0].source, "WORKSPACE");
    await executeApiCommand(
      {
        type: "workspace",
        id: item.id,
        resources: [{ title: "Selected", url: "https://example.com/selected" }],
      },
      token,
    );
    assert.deepEqual(calls.at(-1)?.body, {
      resources: [{ title: "Selected", url: "https://example.com/selected" }],
    });
    assert.ok(calls.at(-1)?.path.endsWith("/resources/bulk"));
    await executeApiCommand(
      {
        type: "checkpoint",
        id: item.id,
        input: {
          requestId: "test-attempt",
          whereILeftOff: "Stopped",
          nextAction: "Next",
        },
      },
      token,
    );
    assert.ok(calls.at(-1)?.path.endsWith("/checkpoints"));
    const service = createSessionService(
      storage,
      () => {},
      "http://localhost:3001/api",
    );
    assert.deepEqual(
      await service.history({
        type: "history",
        id: item.id,
        limit: 5,
        offset: 0,
      }),
      { checkpoints: [], hasMore: false },
    );
    expired = true;
    await assert.rejects(
      service.history({ type: "history", id: item.id, limit: 5, offset: 0 }),
      /Session expired/,
    );
    assert.equal(state[SESSION_KEY], undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("workspace capture filters unsafe tabs; resume deduplicates current/pending tabs and reports failures", async () => {
  const fixture = [
    ...tabs,
    ...[
      "chrome-extension://id/page",
      "edge://settings",
      "about:blank",
      "file:///private",
      "javascript:alert(1)",
      "https://user:secret@example.com",
    ].map(
      (url, index) =>
        ({ id: 10 + index, index: 10 + index, url }) as chrome.tabs.Tab,
    ),
  ];
  assert.deepEqual(
    selectableTabs(fixture).choices.map((r) => r.id),
    [1, 2, 3],
  );
  let allowed = false,
    queries = 0,
    failure = true;
  const opened: chrome.tabs.CreateProperties[] = [];
  Object.assign(globalThis, {
    chrome: {
      runtime: { id: "test" },
      permissions: { request: async () => allowed },
      tabs: {
        query: async (query: chrome.tabs.QueryInfo) => {
          assert.deepEqual(query, { currentWindow: true });
          queries++;
          return [{ ...tabs[0], url: undefined, pendingUrl: tabs[0].url }];
        },
        create: async (properties: chrome.tabs.CreateProperties) => {
          if (failure && properties.url?.includes("docs"))
            throw new Error("Tab closed");
          opened.push(properties);
        },
      },
    },
  });
  await assert.rejects(currentWorkspaceTabs(), /not granted/);
  assert.equal(queries, 0);
  allowed = true;
  const choices = selectableTabs(tabs).choices;
  const result = await resumeWorkspace([
    ...choices,
    choices[1],
    { title: "Unsafe", url: "chrome://settings" },
  ]);
  assert.deepEqual(result, { opened: 1, alreadyOpen: 1, failed: 2 });
  assert.deepEqual(opened, [{ url: tabs[1].url, active: false, windowId: 7 }]);
  failure = false;
  await assert.rejects(resumeWorkspace([]), /Select at least/);
  await assert.rejects(resumeWorkspace(Array(51).fill(choices[0])), /50 tabs/);
});

test("selected workspace capture, checkpoint retry drafts and compact history work together", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://extension.test/workspace.html",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    history: dom.window.history,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  let item = seedItems()[0];
  const checkpoints: WorkCheckpoint[] = [];
  const commands: Command[] = [];
  let failSave = true,
    failCheckpoint = true;
  let update = () => {};
  const opened: string[] = [];
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        id: "test",
        onMessage: { addListener() {}, removeListener() {} },
        async sendMessage({
          channel,
          command,
        }: {
          channel: string;
          command: Command | HistoryCommand;
        }) {
          if (channel === "reentry-history" && command.type === "history")
            return {
              history: {
                checkpoints: checkpoints.slice(
                  command.offset,
                  command.offset + command.limit,
                ),
                hasMore: checkpoints.length > command.offset + command.limit,
              },
            };
          if (command.type === "history") throw new Error("Wrong channel");
          commands.push(structuredClone(command));
          if (command.type === "workspace") {
            if (failSave) return { error: "Network unavailable" };
            item = {
              ...item,
              resources: [
                ...item.resources,
                ...command.resources.map((r) => ({
                  ...r,
                  source: "WORKSPACE" as const,
                  id: crypto.randomUUID(),
                })),
              ],
            };
          }
          if (command.type === "remove-resource")
            item = {
              ...item,
              resources: item.resources.filter(
                (r) => r.id !== command.resourceId,
              ),
            };
          if (command.type === "checkpoint") {
            if (failCheckpoint) return { error: "Network unavailable" };
            checkpoints.unshift({
              id: crypto.randomUUID(),
              workItemId: item.id,
              whereILeftOff: command.input.whereILeftOff,
              nextAction: command.input.nextAction,
              createdAt: new Date().toISOString(),
            });
            item = {
              ...item,
              whereILeftOff: command.input.whereILeftOff,
              nextAction: command.input.nextAction,
            };
          }
          update();
          return { items: [] };
        },
      },
      permissions: { request: async () => true },
      tabs: {
        query: async () => tabs,
        create: async ({ url }: { url: string }) => {
          opened.push(url);
        },
      },
    },
  });
  const { render, screen, waitFor, cleanup, within } = await import(
    "@testing-library/react"
  );
  const { default: userEvent } = await import("@testing-library/user-event");
  const { WorkspacePanel } = await import("../src/WorkspacePanel");
  const { CheckpointForm, RecentProgress } = await import("../src/Checkpoints");
  function Harness() {
    const [revision, setRevision] = React.useState(0);
    const [form, setForm] = React.useState(true);
    update = () => setRevision((v) => v + 1);
    return (
      <>
        <WorkspacePanel item={item} />
        {form && (
          <CheckpointForm
            id={item.id}
            left=""
            next=""
            close={() => setForm(false)}
            saved={() => {
              setForm(false);
              update();
            }}
          />
        )}
        <RecentProgress
          id={item.id}
          updatedAt={item.updatedAt}
          revision={revision}
        />
      </>
    );
  }
  try {
    const user = userEvent.setup({ document: dom.window.document });
    render(<Harness />);
    await screen.findByText(/Your first checkpoint/);
    await user.click(screen.getByRole("button", { name: "Save Workspace" }));
    const picker = within(
      await screen.findByRole("group", { name: "Choose current tabs" }),
    );
    assert.equal(picker.getAllByRole("checkbox").length, 3);
    assert.ok(
      picker
        .getAllByRole("checkbox")
        .every((c) => !(c as HTMLInputElement).checked),
    );
    await user.click(picker.getByRole("checkbox", { name: /Lecture/ }));
    await user.click(
      screen.getByRole("button", { name: "Save selected tabs" }),
    );
    assert.ok(await screen.findByText(/Unable to save workspace/));
    assert.equal(
      (picker.getByRole("checkbox", { name: /Lecture/ }) as HTMLInputElement)
        .checked,
      true,
    );
    failSave = false;
    await user.click(
      screen.getByRole("button", { name: "Save selected tabs" }),
    );
    await screen.findByRole("checkbox", { name: "Resume Lecture" });
    assert.equal(item.resources.length, 2);
    assert.equal(item.resources[1].url, tabs[1].url);
    assert.equal(
      item.resources[0].source,
      undefined,
      "manual resource is retained",
    );
    await user.click(screen.getByRole("button", { name: /Resume Work/ }));
    await screen.findByText("0 tabs opened. 1 already open in this window.");
    assert.deepEqual(opened, []);
    await user.type(
      screen.getByLabelText("Where did you stop?"),
      "Finished replication",
    );
    await user.type(
      screen.getByLabelText("What should you do next?"),
      "Understand consistent hashing",
    );
    await user.click(screen.getByRole("button", { name: "Save checkpoint" }));
    await screen.findByText(/Checkpoint failed to save/);
    assert.equal(
      (screen.getByLabelText("Where did you stop?") as HTMLTextAreaElement)
        .value,
      "Finished replication",
    );
    assert.equal(
      (screen.getByLabelText("What should you do next?") as HTMLTextAreaElement)
        .value,
      "Understand consistent hashing",
    );
    failCheckpoint = false;
    await user.click(screen.getByRole("button", { name: "Save checkpoint" }));
    await waitFor(() =>
      assert.equal(
        screen.queryByRole("form", { name: "Save a checkpoint" }),
        null,
      ),
    );
    const attempts = commands.filter((c) => c.type === "checkpoint");
    assert.equal(attempts[0].input.requestId, attempts[1].input.requestId);
    assert.ok(await screen.findByText("Finished replication"));
    const history = within(
      screen.getByRole("region", { name: "Recent progress" }),
    );
    assert.equal(history.getAllByRole("listitem").length, 1);
    // More than five entries stay compact until explicitly expanded.
    for (let index = 0; index < 6; index++)
      checkpoints.push({
        ...checkpoints[0],
        id: crypto.randomUUID(),
        whereILeftOff: `Earlier checkpoint ${index}`,
      });
    const { act } = await import("@testing-library/react");
    await act(async () => update());
    await screen.findByRole("button", { name: "Show more progress" });
    assert.equal(history.getAllByRole("listitem").length, 5);
    await user.click(
      screen.getByRole("button", { name: "Show more progress" }),
    );
    await waitFor(() =>
      assert.equal(history.getAllByRole("listitem").length, 7),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove resource Lecture" }),
    );
    await waitFor(() => assert.equal(item.resources.length, 1));
  } finally {
    cleanup();
    dom.window.close();
  }
});
