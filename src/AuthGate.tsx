import React, { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { authRequest, subscribe } from "./transport";
import type { SessionView } from "./api";
import { App } from "./App";
import { readAuthDraft, saveAuthDraft, type AuthDraft } from "./auth-draft";

export function AuthGate() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [formError, setFormError] = useState("");
  const draftTouched = useRef(false);
  function updateDraft(patch: Partial<AuthDraft>) {
    draftTouched.current = true;
    const draft = { mode, email, password, confirmation, ...patch };
    setMode(draft.mode);
    setEmail(draft.email);
    setPassword(draft.password);
    setConfirmation(draft.confirmation);
    setFormError("");
    void saveAuthDraft(draft).catch(() =>
      setFormError(
        "Your input could not be kept for reopening this popup. Keep it open while signing in.",
      ),
    );
  }
  useEffect(() => {
    let active = true;
    void readAuthDraft()
      .then((draft) => {
        if (!active || draftTouched.current || !draft) return;
        setMode(draft.mode);
        setEmail(draft.email);
        setPassword(draft.password);
        setConfirmation(draft.confirmation);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const [checking, setChecking] = useState(true);
  const revision = useRef(0);
  const authenticating = useRef(false);
  async function refresh() {
    if (authenticating.current) return;
    const currentRevision = ++revision.current;
    setChecking(true);
    try {
      const current = await authRequest({ type: "session" });
      if (currentRevision !== revision.current) return;
      setSession((previous) =>
        previous?.user?.id === current.user?.id
          ? { ...current, warning: previous?.warning }
          : current,
      );
      if (current.user) void saveAuthDraft().catch(() => undefined);
      setError("");
    } catch (e) {
      if (currentRevision === revision.current) setError((e as Error).message);
    } finally {
      if (currentRevision === revision.current) setChecking(false);
    }
  }
  useEffect(() => {
    void refresh();
    const unsubscribe = subscribe(() => void refresh());
    return () => {
      ++revision.current;
      unsubscribe();
    };
  }, []);
  async function logout() {
    authenticating.current = true;
    ++revision.current;
    setChecking(false);
    setBusy(true);
    try {
      setSession(await authRequest({ type: "logout" }));
      setDeferred(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      authenticating.current = false;
      setBusy(false);
    }
  }
  if (session?.user)
    return (
      <>
        <div className="account-bar">
          <span title={session.user.email}>{session.user.email}</span>
          <button disabled={busy} onClick={() => void logout()}>
            Log out
          </button>
        </div>
        {session.migrationCount > 0 && !deferred && (
          <section className="migration-banner">
            <strong>Bring your V1 context with you</strong>
            <p>
              Import {session.migrationCount} local work items into{" "}
              {session.user.email}. Your local copy will be kept. Import this
              device’s data only into the account it belongs to.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setSession(await authRequest({ type: "migrate" }));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Importing…" : "Import local work"}
            </button>
            <button disabled={busy} onClick={() => setDeferred(true)}>
              Not now
            </button>
          </section>
        )}
        {error && (
          <p className="auth-error error" role="alert">
            {error}
          </p>
        )}
        <App key={session.user.id} />
      </>
    );
  return (
    <main className="auth-shell">
      <div className="brand">
        <span className="brand-icon">
          <RotateCcw size={21} />
        </span>
        ReEntry<span className="brand-dot">.</span>
      </div>
      <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
      <p>Pick up where you left off. Your work and resources, together.</p>
      {new URLSearchParams(location.search).has("saveUrl") && (
        <p className="capture-pending">
          Your captured page is waiting. Log in, then choose its work item.
        </p>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button disabled={busy || checking} onClick={() => void refresh()}>
            Retry connection
          </button>
        </div>
      )}
      {session?.warning && <p role="status">{session.warning}</p>}
      {checking && !session && !error && (
        <p className="muted" role="status">
          Checking your session… You can log in below.
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (mode === "register" && password !== confirmation) {
            setFormError("Passwords do not match.");
            return;
          }
          setFormError("");
          authenticating.current = true;
          ++revision.current;
          setChecking(false);
          setBusy(true);
          setError("");
          try {
            setSession(
              await authRequest({ type: mode, email: email.trim(), password }),
            );
            void saveAuthDraft().catch(() => undefined);
            setPassword("");
            setConfirmation("");
            setShowPassword(false);
            setShowConfirmation(false);
            setDeferred(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            authenticating.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => updateDraft({ email: e.target.value })}
            />
          </label>
          <label htmlFor="auth-password">Password</label>
          <div className="auth-password">
            <input
              id="auth-password"
              required
              type={showPassword ? "text" : "password"}
              minLength={mode === "register" ? 10 : undefined}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => updateDraft({ password: e.target.value })}
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {mode === "register" && (
            <>
              <p className="muted">
                Use at least 10 characters for your password.
              </p>
              <label htmlFor="auth-confirmation">Confirm password</label>
              <div className="auth-password">
                <input
                  id="auth-confirmation"
                  required
                  type={showConfirmation ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(e) =>
                    updateDraft({ confirmation: e.target.value })
                  }
                  aria-invalid={formError === "Passwords do not match."}
                  aria-describedby={formError ? "auth-form-error" : undefined}
                />
                <button
                  type="button"
                  aria-label={
                    showConfirmation
                      ? "Hide confirmed password"
                      : "Show confirmed password"
                  }
                  aria-pressed={showConfirmation}
                  onClick={() => setShowConfirmation(!showConfirmation)}
                >
                  {showConfirmation ? "Hide" : "Show"}
                </button>
              </div>
            </>
          )}
          {formError && (
            <p id="auth-form-error" className="error" role="alert">
              {formError}
            </p>
          )}
          <button className="primary" type="submit">
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </button>
          <button
            type="button"
            onClick={() => {
              updateDraft({ mode: mode === "login" ? "register" : "login" });
              setShowPassword(false);
              setShowConfirmation(false);
              setError("");
            }}
          >
            {mode === "login"
              ? "New here? Sign up"
              : "Already have an account? Log in"}
          </button>
        </fieldset>
      </form>
    </main>
  );
}
