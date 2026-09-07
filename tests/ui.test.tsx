import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { JSDOM } from "jsdom";
import React from "react";
import {
  applyCommand,
  seedItems,
  STORAGE_KEY,
  type Command,
} from "../src/model";

test("workspace interactions: capture, create, resume, edit context, checklist, filter, search, delete", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://extension.test/workspace.html?saveTitle=Example%20page&saveUrl=https%3A%2F%2Fexample.com%2F",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    history: dom.window.history,
    HTMLElement: dom.window.HTMLElement,
    HTMLDialogElement: dom.window.HTMLDialogElement,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  let items = seedItems();
  const listeners = new Set<(changes: unknown, area: string) => void>();
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        id: "test",
        async sendMessage({ command }: { command: Command }) {
          items = applyCommand(items, command);
          listeners.forEach((fn) =>
            fn(
              { [STORAGE_KEY]: { newValue: structuredClone(items) } },
              "local",
            ),
          );
          return { items: structuredClone(items) };
        },
      },
      storage: {
        onChanged: {
          addListener(fn: (changes: unknown, area: string) => void) {
            listeners.add(fn);
          },
          removeListener(fn: (changes: unknown, area: string) => void) {
            listeners.delete(fn);
          },
        },
      },
    },
  });
  const { render, screen, waitFor, cleanup, within } = await import(
    "@testing-library/react"
  );
  const { default: userEvent } = await import("@testing-library/user-event");
  const { App } = await import("../src/App");
  const user = userEvent.setup({ document: dom.window.document });
  render(<App />);
  await screen.findByText("Keep this in context");
  await waitFor(() => assert.equal(screen.getAllByRole("option").length, 4));
  await user.click(screen.getByRole("button", { name: "Save resource" }));
  await waitFor(() => assert.equal(items[0].resources.length, 2));
  await user.click(screen.getByRole("button", { name: "New work item" }));
  await user.type(screen.getByLabelText("Title"), "Portfolio project");
  await user.type(screen.getByLabelText("Category"), "Personal Project");
  await user.type(screen.getByLabelText("Goal"), "Ship a thoughtful MVP.");
  await user.type(
    screen.getByLabelText("Where I Left Off"),
    "Finished the layout.",
  );
  await user.type(screen.getByLabelText("Next Action"), "Test the extension.");
  await user.click(screen.getByRole("button", { name: "Add step" }));
  await user.type(
    screen.getByLabelText("Step 1", { exact: true }),
    "Run the build",
  );
  await user.click(screen.getByRole("button", { name: "Save work item" }));
  await screen.findByRole("button", { name: "Portfolio project" });
  assert.equal(items.length, 4);
  const inventory = within(screen.getByRole("main", { name: "Work items" }));
  assert.equal(inventory.queryAllByRole("article").length, 0);
  assert.equal(inventory.getAllByRole("listitem").length, 4);
  assert.deepEqual(
    inventory
      .getAllByRole("button")
      .map((row) => row.getAttribute("aria-labelledby")),
    [
      `work-title-${items[0].id}`,
      `work-title-${items[1].id}`,
      `work-title-${items[3].id}`,
      `work-title-${items[2].id}`,
    ],
  );
  assert.ok(inventory.getByText("Test the extension."));
  assert.equal(inventory.queryByText("Finished the layout."), null);
  assert.equal(
    inventory.getAllByRole("button")[0].querySelector("time")?.dateTime,
    items[0].updatedAt,
  );
  screen.getByRole("button", { name: "Portfolio project" }).focus();
  await user.keyboard("{Enter}");
  assert.equal(screen.queryByRole("dialog"), null);
  assert.ok(screen.getByRole("heading", { name: "Portfolio project" }));
  const next = screen.getByLabelText(/02 \/ NEXT ACTION/);
  await user.clear(next);
  await user.type(next, "Load the extension in Chrome.");
  await user.click(screen.getByRole("button", { name: "Save context" }));
  await waitFor(() =>
    assert.equal(items[3].nextAction, "Load the extension in Chrome."),
  );
  await user.click(screen.getByRole("checkbox", { name: "Run the build" }));
  await waitFor(() => assert.equal(items[3].checklist[0].completed, true));
  await user.click(screen.getByRole("button", { name: "Edit item" }));
  await user.selectOptions(screen.getByLabelText("Status"), "Done");
  await user.clear(screen.getByLabelText("Next Action"));
  await user.type(
    screen.getByLabelText("Next Action"),
    "Demo the finished project.",
  );
  await user.click(screen.getByRole("button", { name: "Save work item" }));
  await waitFor(() =>
    assert.equal(
      (screen.getByLabelText(/02 \/ NEXT ACTION/) as HTMLTextAreaElement).value,
      "Demo the finished project.",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Your work" }));
  const reordered = within(
    screen.getByRole("main", { name: "Work items" }),
  ).getAllByRole("button");
  assert.equal(
    reordered.at(-1)?.getAttribute("aria-labelledby"),
    `work-title-${items[3].id}`,
  );
  assert.equal(
    reordered[0].getAttribute("aria-labelledby"),
    `work-title-${items[0].id}`,
  );
  await user.click(screen.getByRole("button", { name: "Done" }));
  assert.equal(screen.getAllByRole("listitem").length, 1);
  await user.type(
    screen.getByRole("textbox", { name: "Search work items" }),
    "missing",
  );
  assert.ok(screen.getByText("A clear space."));
  await user.clear(screen.getByRole("textbox", { name: "Search work items" }));
  await user.click(screen.getByRole("button", { name: "Portfolio project" }));
  await user.click(screen.getByRole("button", { name: "Edit item" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await user.click(
    screen.getByRole("button", { name: "Yes, delete work item" }),
  );
  await waitFor(() => assert.equal(items.length, 3));
  cleanup();
  dom.window.close();
});
