import React, { useEffect, useRef, useState } from "react";
import { Check, Layers } from "lucide-react";
import type { CheckpointPage, WorkspaceLink } from "./model";
import { currentWorkspaceTabs, type TabChoice } from "./browser-workspace";
import { request, requestHistory } from "./transport";
import { TabPicker } from "./WorkspacePanel";

export function CheckpointForm({
  id,
  left,
  next,
  close,
  saved,
}: {
  id: string;
  left: string;
  next: string;
  close: () => void;
  saved: (left: string, next: string) => void;
}) {
  const [whereILeftOff, setLeft] = useState(left);
  const [nextAction, setNext] = useState(next);
  const [tabs, setTabs] = useState<{
    choices: TabChoice[];
    skipped: number;
  } | null>(null);
  const [selected, setSelected] = useState<WorkspaceLink[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef(crypto.randomUUID());
  async function capture() {
    setBusy("tabs");
    setError("");
    try {
      setTabs(await currentWorkspaceTabs());
      setSelected([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      await request({
        type: "checkpoint",
        id,
        input: {
          requestId: requestId.current,
          whereILeftOff,
          nextAction,
          ...(selected.length ? { resources: selected } : {}),
        },
      });
      saved(whereILeftOff.trim(), nextAction.trim());
    } catch (e) {
      setError(
        `Checkpoint failed to save. Your draft is still here. ${(e as Error).message}`,
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <form
      className="inline-panel checkpoint-form"
      onSubmit={(e) => void submit(e)}
      aria-label="Save a checkpoint"
    >
      <h2>Leave a starting point for next time.</h2>
      <label>
        Where did you stop?
        <textarea
          autoFocus
          required
          maxLength={20000}
          rows={3}
          disabled={!!busy}
          value={whereILeftOff}
          onChange={(e) => setLeft(e.target.value)}
        />
      </label>
      <label className="checkpoint-next">
        What should you do next?
        <textarea
          required
          maxLength={20000}
          rows={2}
          disabled={!!busy}
          value={nextAction}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <button type="button" disabled={!!busy} onClick={() => void capture()}>
        <Layers size={16} />
        {busy === "tabs" ? "Loading tabs…" : "Choose current tabs (optional)"}
      </button>
      {tabs && (
        <>
          <TabPicker
            choices={tabs.choices}
            selected={selected}
            onChange={setSelected}
            disabled={!!busy}
          />
          <p className="muted">
            {tabs.skipped} unsupported or duplicate tabs omitted. Selected pages
            are added to your workspace.
          </p>
        </>
      )}
      <p className="muted">
        Save before closing ReEntry. Unsaved checkpoint text stays in this open
        form.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="panel-actions">
        <button type="button" disabled={!!busy} onClick={close}>
          Cancel checkpoint
        </button>
        <button
          className="primary"
          disabled={!!busy || !whereILeftOff.trim() || !nextAction.trim()}
        >
          <Check size={16} />
          {busy === "save" ? "Saving checkpoint…" : "Save checkpoint"}
        </button>
      </div>
    </form>
  );
}

export function RecentProgress({
  id,
  updatedAt,
  revision,
}: {
  id: string;
  updatedAt: string;
  revision: number;
}) {
  const [limit, setLimit] = useState(5);
  const [page, setPage] = useState<CheckpointPage>({
    checkpoints: [],
    hasMore: false,
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    // Re-read the displayed prefix to avoid duplicates when another profile adds history.
    void (async () => {
      const checkpoints: CheckpointPage["checkpoints"] = [];
      let hasMore = false;
      for (let offset = 0; offset < limit; offset += 50) {
        const result = await requestHistory({
          type: "history",
          id,
          offset,
          limit: Math.min(50, limit - offset),
        });
        if (!active) return;
        checkpoints.push(...result.checkpoints);
        hasMore = result.hasMore;
        if (!hasMore) break;
      }
      if (active) {
        setPage({
          checkpoints: [...new Map(checkpoints.map((c) => [c.id, c])).values()],
          hasMore,
        });
        setError("");
      }
    })()
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, updatedAt, revision, limit, retry]);
  return (
    <section
      className="detail-section recent-progress"
      aria-label="Recent progress"
    >
      <div className="section-heading">
        <h2>Recent progress</h2>
        <span>Your stopping points</span>
      </div>
      {loading && (
        <p className="muted" role="status">
          Loading recent progress…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
          <button onClick={() => setRetry((value) => value + 1)}>
            Retry history
          </button>
        </p>
      )}
      {!loading && !error && !page.checkpoints.length && (
        <p className="muted">
          Your first checkpoint starts the story. Save one when you pause this
          work.
        </p>
      )}
      <ol className="checkpoint-list">
        {page.checkpoints.map((checkpoint) => (
          <li key={checkpoint.id}>
            <time dateTime={checkpoint.createdAt}>
              {new Date(checkpoint.createdAt).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
            <p>{checkpoint.whereILeftOff}</p>
            <p className="checkpoint-next">
              <span aria-hidden="true">→ </span>
              <strong>Next: </strong>
              {checkpoint.nextAction}
            </p>
          </li>
        ))}
      </ol>
      {page.hasMore && (
        <button
          disabled={loading}
          onClick={() => setLimit((value) => value + 5)}
        >
          Show more progress
        </button>
      )}
    </section>
  );
}
