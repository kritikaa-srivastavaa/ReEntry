import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import pg from "pg";
const root = new URL("../../", import.meta.url);
const stateFile = new URL(".reentry-dev/smoke-session.json", root);
const phase = process.argv[2];
if (!["prepare", "verify"].includes(phase))
  throw new Error("Use prepare or verify.");
const base = "http://127.0.0.1:3001/api";
async function api(path, method = "GET", body, token, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(
    response.status,
    expected,
    `${method} ${path}: unexpected status`,
  );
  return response.status === 204 ? null : response.json();
}
if (phase === "prepare") {
  await api("/health");
  const state = {
    password: randomUUID() + randomUUID(),
    users: [],
    itemId: "",
  };
  await writeFile(stateFile, JSON.stringify(state), { flag: "wx" });
  for (const suffix of ["a", "b"]) {
    const email = `reentry-smoke-${randomUUID()}-${suffix}@example.invalid`;
    const session = await api(
      "/auth/register",
      "POST",
      { email, password: state.password },
      undefined,
      201,
    );
    state.users.push({ id: session.user.id, email, token: session.token });
    await writeFile(stateFile, JSON.stringify(state));
  }
  const [a, b] = state.users;
  await api("/auth/login", "POST", {
    email: a.email,
    password: state.password,
  });
  const created = await api(
    "/work-items",
    "POST",
    {
      title: "Temporary restart smoke check",
      category: "Smoke test",
      status: "IN_PROGRESS",
      nextAction: "Verify persistence",
      checklist: [{ text: "Verify API", completed: false }],
    },
    a.token,
    201,
  );
  state.itemId = created.item.id;
  await writeFile(stateFile, JSON.stringify(state));
  await api(
    `/work-items/${state.itemId}`,
    "PATCH",
    {
      whereILeftOff: "Checked the live API",
      nextAction: "Verify after restart",
      status: "DONE",
    },
    a.token,
  );
  await api(
    `/work-items/${state.itemId}/checklist/${created.item.checklist[0].id}`,
    "PATCH",
    { completed: true },
    a.token,
    204,
  );
  await api(
    `/work-items/${state.itemId}/resources`,
    "POST",
    {
      title: "Captured smoke resource",
      url: "https://example.com/reentry-smoke",
    },
    a.token,
    201,
  );
  await api(`/work-items/${state.itemId}`, "GET", undefined, b.token, 404);
  assert.deepEqual(
    (await api("/work-items", "GET", undefined, b.token)).items,
    [],
  );
  console.log(
    "Live signup/login, CRUD, checklist/resource save, and account-isolation checks passed. Restart ReEntry, then run verify.",
  );
} else {
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const config = JSON.parse(
    await readFile(new URL(".reentry-dev/local-config.json", root), "utf8"),
  );
  try {
    const [a] = state.users;
    const { user } = await api("/auth/me", "GET", undefined, a.token);
    assert.equal(user.id, a.id);
    const { item } = await api(
      `/work-items/${state.itemId}`,
      "GET",
      undefined,
      a.token,
    );
    assert.equal(item.status, "DONE");
    assert.equal(item.nextAction, "Verify after restart");
    assert.equal(item.checklist[0].completed, true);
    assert.equal(item.resources[0].url, "https://example.com/reentry-smoke");
    await api("/auth/logout", "POST", undefined, a.token, 204);
    await api("/auth/me", "GET", undefined, a.token, 401);
    await api("/auth/login", "POST", {
      email: a.email,
      password: state.password,
    });
    console.log(
      "Database and JWT session persistence across a full local restart passed. Logout revocation and subsequent login passed.",
    );
  } finally {
    const db = new pg.Client({
      host: "127.0.0.1",
      port: config.port,
      user: "reentry_admin",
      password: config.adminPassword,
      database: "reentry",
    });
    await db.connect();
    try {
      for (const user of state.users) {
        assert.match(
          user.email,
          /^reentry-smoke-[a-f0-9-]+-[ab]@example\.invalid$/,
        );
        await db.query("DELETE FROM users WHERE id = $1 AND email = $2", [
          user.id,
          user.email,
        ]);
      }
    } finally {
      await db.end();
    }
    await unlink(stateFile);
    console.log(
      "Removed only the temporary smoke-test accounts and their data.",
    );
  }
}
