import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { applyCommand, safeUrl, seedItems } from "../src/model";
import { compareWorkItems, displayStatuses } from "../src/presentation";
Object.defineProperty(globalThis, "crypto", { value: webcrypto });

test("inventory prioritizes active work ahead of newer completed items and sorts each group newest first", () => {
  const base = seedItems()[0];
  const items = displayStatuses
    .flatMap((status, index) => [
      {
        ...base,
        id: `${status}-old`,
        status,
        updatedAt: `2026-09-0${index + 1}T10:00:00.000Z`,
      },
      {
        ...base,
        id: `${status}-new`,
        status,
        updatedAt: `2026-09-0${index + 1}T11:00:00.000Z`,
      },
    ])
    .reverse();
  const sorted = [...items].sort(compareWorkItems);
  assert.deepEqual(
    sorted.map((item) => item.id),
    [
      "In Progress-new",
      "In Progress-old",
      "Not Started-new",
      "Not Started-old",
      "Done-new",
      "Done-old",
    ],
  );
  assert.equal(items[0].id, "Done-new");
  assert.deepEqual(
    items
      .filter((item) => item.status === "Not Started")
      .sort(compareWorkItems)
      .map((item) => item.id),
    ["Not Started-new", "Not Started-old"],
  );
});

test("sample work contains the requested context and independent checklists", () => {
  const items = seedItems();
  assert.equal(items.length, 3);
  assert.equal(
    items[0].whereILeftOff,
    "Finished understanding L4 vs L7 load balancing.",
  );
  assert.equal(items[1].nextAction, "Solve Lowest Common Ancestor.");
  assert.equal(items[2].status, "Not Started");
  assert.equal(new Set(items.map((i) => i.id)).size, 3);
});
test("context and checklist updates compose without dropping resources or other items", () => {
  const initial = seedItems();
  const changed = applyCommand(initial, {
    type: "patch",
    id: initial[0].id,
    patch: { nextAction: "Sketch failure handling." },
  });
  const checked = applyCommand(changed, {
    type: "check",
    id: initial[0].id,
    checkId: "lb-2",
    completed: true,
  });
  assert.equal(checked[0].nextAction, "Sketch failure handling.");
  assert.equal(checked[0].checklist[1].completed, true);
  assert.equal(initial[0].checklist[1].completed, false);
  assert.deepEqual(checked[0].resources, initial[0].resources);
  assert.deepEqual(checked[1], initial[1]);
  const unchecked = applyCommand(checked, {
    type: "check",
    id: initial[0].id,
    checkId: "lb-2",
    completed: false,
  });
  assert.equal(unchecked[0].checklist[1].completed, false);
});
test("resource capture deduplicates URLs and rejects unsafe protocols", () => {
  const items = seedItems();
  const command = {
    type: "resource" as const,
    id: items[0].id,
    title: "Reference",
    url: "https://example.com/notes",
  };
  const once = applyCommand(items, command);
  const twice = applyCommand(once, command);
  assert.equal(twice[0].resources.length, items[0].resources.length + 1);
  assert.throws(
    () => applyCommand(items, { ...command, url: "javascript:alert(1)" }),
    /http/,
  );
  assert.equal(safeUrl("file:///etc/passwd"), false);
  assert.equal(safeUrl("not a URL"), false);
});
test("create, complete, and delete preserve identity and reject missing records", () => {
  const sample = seedItems()[0];
  const created = applyCommand([], { type: "create", item: sample });
  assert.notEqual(created[0].id, sample.id);
  const completed = applyCommand(created, {
    type: "patch",
    id: created[0].id,
    patch: { status: "Done" },
  });
  assert.equal(completed[0].status, "Done");
  assert.equal(completed[0].createdAt, created[0].createdAt);
  assert.deepEqual(
    applyCommand(completed, { type: "delete", id: created[0].id }),
    [],
  );
  assert.throws(
    () =>
      applyCommand([], {
        type: "patch",
        id: sample.id,
        patch: { title: "Missing" },
      }),
    /no longer exists/,
  );
  assert.throws(
    () => applyCommand([], { type: "create", item: { ...sample, title: " " } }),
    /title/,
  );
});
