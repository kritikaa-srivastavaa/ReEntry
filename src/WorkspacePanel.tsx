import React, { useState } from "react";
import { ExternalLink, Layers, Play, Trash2 } from "lucide-react";
import { type WorkItem, type WorkspaceLink, safeUrl } from "./model";
import {
  currentWorkspaceTabs,
  resumeWorkspace,
  type TabChoice,
} from "./browser-workspace";
import { request } from "./transport";

export function TabPicker({
  choices,
  selected,
  onChange,
  disabled = false,
}: {
  choices: TabChoice[];
  selected: WorkspaceLink[];
  onChange: (links: WorkspaceLink[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="tab-picker" role="group" aria-label="Choose current tabs">
      <p className="muted">
        Choose up to 50 tabs from this window. Only your selections will be
        saved.
      </p>
      <div className="tab-choice-list">
        {choices.map((tab) => (
          <label className="tab-choice" key={tab.id}>
            <input
              type="checkbox"
              disabled={
                disabled ||
                (selected.length >= 50 &&
                  !selected.some((r) => r.url === tab.url))
              }
              checked={selected.some((r) => r.url === tab.url)}
              onChange={(e) => {
                const urls = new Set(selected.map((r) => r.url));
                if (e.target.checked) urls.add(tab.url);
                else urls.delete(tab.url);
                onChange(
                  choices
                    .filter((r) => urls.has(r.url))
                    .map(({ title, url }) => ({ title, url })),
                );
              }}
            />
            <span>
              <strong>{tab.title}</strong>
              <small>{tab.url}</small>
            </span>
          </label>
        ))}
      </div>
      {!choices.length && (
        <p className="muted">
          No supported web tabs in this window. Open an HTTP or HTTPS page and
          try again.
        </p>
      )}
      <p className="muted">{selected.length} selected</p>
    </div>
  );
}

export function WorkspacePanel({ item }: { item: WorkItem }) {
  const [capture, setCapture] = useState<{
    choices: TabChoice[];
    skipped: number;
  } | null>(null);
  const [selected, setSelected] = useState<WorkspaceLink[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const workspace = item.resources.filter((r) => r.source === "WORKSPACE");
  const other = item.resources.filter((r) => r.source !== "WORKSPACE");
  const chosen = workspace.filter((r) => safeUrl(r.url) && !excluded.has(r.id));
  async function captureTabs() {
    setBusy("capture");
    setError("");
    setNotice("");
    try {
      setCapture(await currentWorkspaceTabs());
      setSelected([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function save() {
    setBusy("save");
    setError("");
    try {
      await request({ type: "workspace", id: item.id, resources: selected });
      setCapture(null);
      setSelected([]);
      setNotice("Workspace saved. Ready for your next session.");
    } catch (e) {
      setError(`Unable to save workspace. ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  }
  async function resume() {
    setBusy("resume");
    setError("");
    setNotice("");
    try {
      const result = await resumeWorkspace(chosen);
      setNotice(
        `${result.opened} tabs opened. ${result.alreadyOpen} already open in this window.`,
      );
      if (result.failed)
        setError(
          `Unable to reopen ${result.failed} resources. Try again; successfully opened tabs will not be duplicated.`,
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function remove(resourceId: string) {
    setBusy(resourceId);
    setError("");
    setNotice("");
    try {
      await request({ type: "remove-resource", id: item.id, resourceId });
      setNotice("Resource removed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section
      className="detail-section workspace-panel"
      aria-label="Saved workspace"
    >
      <div className="section-heading">
        <h2>Workspace</h2>
        <button disabled={!!busy} onClick={() => void captureTabs()}>
          <Layers size={16} />
          {busy === "capture" ? "Loading tabs…" : "Save Workspace"}
        </button>
      </div>
      <p className="muted">
        Your stopping point and next action are above. Choose the saved tabs you
        need to pick back up.
      </p>
      {capture && (
        <div className="inline-panel">
          <TabPicker
            choices={capture.choices}
            selected={selected}
            onChange={setSelected}
            disabled={!!busy}
          />
          {capture.skipped > 0 && (
            <p className="muted">
              {capture.skipped} internal, unavailable, or duplicate tabs
              omitted.
            </p>
          )}
          <div className="panel-actions">
            <button disabled={!!busy} onClick={() => setCapture(null)}>
              Cancel tab selection
            </button>
            <button
              className="primary"
              disabled={!!busy || !selected.length}
              onClick={() => void save()}
            >
              {busy === "save" ? "Saving workspace…" : "Save selected tabs"}
            </button>
          </div>
        </div>
      )}
      {workspace.map((r) => (
        <div className="workspace-resource" key={r.id}>
          <input
            type="checkbox"
            aria-label={`Resume ${r.title}`}
            disabled={!!busy || !safeUrl(r.url)}
            checked={safeUrl(r.url) && !excluded.has(r.id)}
            onChange={(e) =>
              setExcluded((old) => {
                const value = new Set(old);
                if (e.target.checked) value.delete(r.id);
                else value.add(r.id);
                return value;
              })
            }
          />
          <a
            className="resource"
            href={safeUrl(r.url) ? r.url : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <span>
              <strong>{r.title}</strong>
              <small>{r.url}</small>
            </span>
            <ExternalLink size={15} />
          </a>
          <button
            disabled={!!busy}
            onClick={() => void remove(r.id)}
            aria-label={`Remove resource ${r.title}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {!workspace.length && (
        <p className="muted">
          No workspace tabs saved yet. Save Workspace lets you choose pages for
          this work.
        </p>
      )}
      <button
        className="primary resume-work"
        disabled={!!busy || !chosen.length}
        onClick={() => void resume()}
      >
        <Play size={16} />
        {busy === "resume" ? "Opening workspace…" : "Resume Work"}
        {chosen.length > 0 && <span> · {chosen.length} tabs</span>}
      </button>
      {notice && (
        <p className="workspace-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="section-heading other-resources">
        <h2>Other resources</h2>
        <span>{other.length} saved</span>
      </div>
      {other.map((r) => (
        <div className="workspace-resource" key={r.id}>
          <a
            className="resource"
            href={safeUrl(r.url) ? r.url : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} />
            <span>
              <strong>{r.title}</strong>
              <small>{r.url}</small>
            </span>
          </a>
          <button
            disabled={!!busy}
            onClick={() => void remove(r.id)}
            aria-label={`Remove resource ${r.title}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
      {!other.length && (
        <p className="muted">
          Save a page from the popup or add a link in Edit item.
        </p>
      )}
    </section>
  );
}
