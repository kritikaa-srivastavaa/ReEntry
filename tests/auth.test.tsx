import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";

test("a fresh browser dashboard leaves session checking and shows login in StrictMode", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "http://localhost:5173/workspace.html",
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
    chrome: undefined,
  });
  const { render, screen, cleanup, waitFor } = await import(
    "@testing-library/react"
  );
  const { AuthGate } = await import("../src/AuthGate");
  try {
    render(
      <React.StrictMode>
        <AuthGate />
      </React.StrictMode>,
    );
    await screen.findByRole("button", { name: "Log in" });
    assert.ok(screen.getByLabelText("Email"));
    await waitFor(() =>
      assert.equal(screen.queryByText(/Checking your session/), null),
    );
    cleanup();

    // An older worker can answer with a V1 payload instead of a session.
    let reply: () => Promise<unknown> = async () => ({ items: [] });
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          id: "test-extension",
          sendMessage: () => reply(),
          onMessage: { addListener() {}, removeListener() {} },
        },
      },
    });
    render(<AuthGate />);
    assert.match(
      (await screen.findByRole("alert")).textContent || "",
      /incompatible session/,
    );
    assert.equal(screen.queryByText("Checking your session…"), null);
    reply = async () => ({ session: { user: null, migrationCount: 0 } });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    await screen.findByRole("button", { name: "Log in" });
    cleanup();

    // Exercise the UI recovery for a worker that never responds, without a 25s test.
    const originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((
      fn: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ) =>
      originalTimeout(
        fn,
        delay === 25000 || delay === 2000 ? 10 : delay,
        ...args,
      )) as typeof setTimeout;
    try {
      reply = () => new Promise(() => {});
      render(<AuthGate />);
      assert.ok(screen.getByLabelText("Email"));
      assert.ok(screen.getByLabelText("Password"));
      assert.ok(screen.getByRole("button", { name: "Log in" }));
      fireEvent.click(
        screen.getByRole("button", { name: "New here? Sign up" }),
      );
      assert.ok(screen.getByRole("button", { name: "Create account" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Already have an account? Log in" }),
      );
      assert.match(
        (await screen.findByRole("alert")).textContent || "",
        /Session check timed out/,
      );
      assert.equal(screen.queryByText("Checking your session…"), null);
      reply = async () => ({ session: { user: null, migrationCount: 0 } });
      fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
      await screen.findByRole("button", { name: "Log in" });
    } finally {
      globalThis.setTimeout = originalTimeout;
    }
    cleanup();

    const { saveAuthDraft } = await import("../src/auth-draft");
    await saveAuthDraft();
    render(<AuthGate />);
    await waitFor(() =>
      assert.equal(screen.queryByText(/Checking your session/), null),
    );
    fireEvent.click(screen.getByRole("button", { name: "New here? Sign up" }));
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "unfinished@" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "long-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    assert.equal(
      (screen.getByLabelText("Password") as HTMLInputElement).type,
      "text",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show confirmed password" }),
    );
    assert.equal(
      (screen.getByLabelText("Confirm password") as HTMLInputElement).type,
      "text",
    );
    cleanup();
    render(<AuthGate />);
    await waitFor(() =>
      assert.equal(
        (screen.getByLabelText("Email") as HTMLInputElement).value,
        "unfinished@",
      ),
    );
    assert.equal(
      (screen.getByLabelText("Password") as HTMLInputElement).value,
      "long-password",
    );
    assert.equal(
      (screen.getByLabelText("Password") as HTMLInputElement).type,
      "password",
    );
    assert.equal(
      (screen.getByLabelText("Confirm password") as HTMLInputElement).value,
      "different-password",
    );
    assert.equal(
      (screen.getByLabelText("Confirm password") as HTMLInputElement).type,
      "password",
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "test@example.com" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Create account" }).closest("form")!,
    );
    assert.ok(screen.getByText("Passwords do not match."));
    fireEvent.click(
      screen.getByRole("button", { name: "Already have an account? Log in" }),
    );
    assert.equal(screen.queryByLabelText("Confirm password"), null);
    assert.equal(
      (screen.getByLabelText("Email") as HTMLInputElement).value,
      "test@example.com",
    );
    await saveAuthDraft();
  } finally {
    cleanup();
    dom.window.close();
  }
});
