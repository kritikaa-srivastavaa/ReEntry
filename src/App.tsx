import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Check,
  ChevronRight,
  ExternalLink,
  Leaf,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
  Pencil,
} from "lucide-react";
import { type Editable, type WorkItem, statuses, safeUrl } from "./model";
import { request, useWorkItems } from "./storage";
import {
  compareWorkItems,
  displayStatuses,
  statusPresentation,
} from "./presentation";
import { Badge, PopupCards, WorkInventory } from "./WorkInventory";

const popup = location.pathname.endsWith("popup.html");
document.body.className = popup ? "popup-body" : "workspace-body";
const params = new URLSearchParams(location.search);
const emptyItem = (): Editable => ({
  title: "",
  category: "",
  goal: "",
  status: "Not Started",
  whereILeftOff: "",
  nextAction: "",
  checklist: [],
  resources: [],
});
export function App() {
  const { items, loading, error } = useWorkItems();
  const [selected, setSelected] = useState<string | null>(params.get("item"));
  const [editor, setEditor] = useState<WorkItem | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [savePage, setSavePage] = useState<{
    title: string;
    url: string;
  } | null>(
    params.get("saveUrl")
      ? { title: params.get("saveTitle") || "", url: params.get("saveUrl")! }
      : null,
  );
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const current = items.find((item) => item.id === selected);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function capturePage() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.url || !safeUrl(tab.url))
        throw new Error(
          "Open a regular web page (http or https), then save it here.",
        );
      setSavePage({ title: tab.title || tab.url, url: tab.url });
    } catch (e) {
      setActionError((e as Error).message);
    }
  }
  function openWorkspace() {
    void chrome.tabs.create({ url: chrome.runtime.getURL("workspace.html") });
  }
  const visible = items
    .filter(
      (item) =>
        (!popup || item.status !== "Done") &&
        (filter === "All" || item.status === filter) &&
        `${item.title} ${item.category} ${item.goal} ${item.nextAction} ${item.whereILeftOff}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(compareWorkItems);
  return (
    <div className={popup ? "app popup" : "app workspace"}>
      <header className="header">
        <button
          className="brand"
          onClick={() => setSelected(null)}
          aria-label="ReEntry home"
        >
          <span className="brand-icon">
            <RotateCcw size={21} />
          </span>
          ReEntry<span className="brand-dot">.</span>
        </button>
        <span className="header-note">
          {popup
            ? "A little context. A fresh start."
            : "YOUR PLACE TO PICK BACK UP"}
        </span>
        {!popup && (
          <span className="local-label">
            <span /> Saved on this device
          </span>
        )}
      </header>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {(error || actionError) && (
        <div className="error" role="alert">
          {error || actionError}
          {actionError && (
            <button
              aria-label="Dismiss error"
              onClick={() => setActionError("")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
      {loading ? (
        <div className="empty">Gathering your context…</div>
      ) : selected && !current ? (
        <div className="empty">
          This work item is no longer here.
          <button onClick={() => setSelected(null)}>Back to your work</button>
        </div>
      ) : current ? (
        <Detail
          key={current.id}
          item={current}
          back={() => setSelected(null)}
          edit={() =>
            popup
              ? void chrome.tabs.create({
                  url: chrome.runtime.getURL(
                    `workspace.html?item=${current.id}&edit=1`,
                  ),
                })
              : setEditor(current)
          }
          onSaved={() => setNotice("Context saved. Ready for next time.")}
        />
      ) : (
        <>
          <section className="intro">
            <div>
              <div className="eyebrow">
                {popup ? "BACK TO YOUR FLOW" : "LESS RECALL. MORE MOMENTUM."}
              </div>
              <h1>
                {popup
                  ? "Pick up where you left off."
                  : "Your work, waiting for you."}
              </h1>
              <p>
                {popup
                  ? `${items.filter((i) => i.status !== "Done").length} active work items. Your next step is right here.`
                  : "Keep the context. Find your next step. Get back into it."}
              </p>
            </div>
            {!popup && (
              <button className="primary" onClick={() => setEditor("new")}>
                <Plus size={18} />
                New work item
              </button>
            )}
          </section>
          {popup ? (
            <button className="capture-button" onClick={capturePage}>
              <BookmarkPlus size={17} />
              <span>Save this page to a work item</span>
              <Plus size={16} />
            </button>
          ) : (
            <div className="toolbar">
              <div className="filters" aria-label="Filter by status">
                {(["All", ...displayStatuses] as const).map((status) => (
                  <button
                    key={status}
                    className={`${filter === status ? "active" : ""} ${status === "All" ? "" : statusPresentation[status].className}`}
                    aria-pressed={filter === status}
                    onClick={() => setFilter(status)}
                  >
                    {status}
                    {status === "All" && <span>{items.length}</span>}
                  </button>
                ))}
              </div>
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Search work items"
                  placeholder="Find your work…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
          )}
          <div className="section-label">
            <span>
              {popup
                ? "ONGOING WORK"
                : filter === "All"
                  ? "ALL WORK ITEMS"
                  : filter.toUpperCase()}
            </span>
            <span>{visible.length.toString().padStart(2, "0")}</span>
          </div>
          {popup ? (
            <PopupCards items={visible} resume={setSelected} />
          ) : (
            <WorkInventory items={visible} resume={setSelected} />
          )}
          {!visible.length && (
            <div className="empty">
              <Leaf size={30} />
              <h2>
                {items.length
                  ? "A clear space."
                  : "Start something worth returning to."}
              </h2>
              <p>
                {query || filter !== "All"
                  ? "Try another search or status filter."
                  : popup
                    ? "No active work. Create your next work item on the full page."
                    : "Add your first work item and leave yourself a next step."}
              </p>
              <button
                className="primary"
                onClick={() => (popup ? openWorkspace() : setEditor("new"))}
              >
                {popup ? "Open your work" : "Create a work item"}
                <Plus size={16} />
              </button>
            </div>
          )}
          {popup ? (
            <footer className="popup-footer">
              <span>Your context stays with you.</span>
              <button onClick={openWorkspace}>
                SEE ALL <ArrowRight size={16} />
              </button>
            </footer>
          ) : (
            <footer className="workspace-footer">
              <Leaf size={15} />A place for ongoing work, and the thoughts
              between sessions.
            </footer>
          )}
        </>
      )}
      {!popup && current && params.get("edit") === "1" && !editor && (
        <EditOnLoad item={current} edit={setEditor} />
      )}
      {editor && (
        <Editor
          item={editor === "new" ? undefined : editor}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            setNotice("Work item saved.");
          }}
          deleted={() => {
            setEditor(null);
            setSelected(null);
            setNotice("Work item deleted.");
          }}
        />
      )}
      {savePage && (
        <SavePage
          page={savePage}
          items={items}
          close={() => {
            setSavePage(null);
            history.replaceState(null, "", location.pathname);
          }}
          saved={() => {
            setSavePage(null);
            history.replaceState(null, "", location.pathname);
            setNotice("Resource saved to your work item.");
          }}
        />
      )}
    </div>
  );
}
function EditOnLoad({
  item,
  edit,
}: {
  item: WorkItem;
  edit: (item: WorkItem) => void;
}) {
  useEffect(() => {
    params.delete("edit");
    edit(item);
  }, []);
  return null;
}
function Detail({
  item,
  back,
  edit,
  onSaved,
}: {
  item: WorkItem;
  back: () => void;
  edit: () => void;
  onSaved: () => void;
}) {
  const [left, setLeft] = useState(item.whereILeftOff);
  const [next, setNext] = useState(item.nextAction);
  const previousContext = useRef({
    left: item.whereILeftOff,
    next: item.nextAction,
  });
  useEffect(() => {
    const previous = previousContext.current;
    setLeft((value) => (value === previous.left ? item.whereILeftOff : value));
    setNext((value) => (value === previous.next ? item.nextAction : value));
    previousContext.current = {
      left: item.whereILeftOff,
      next: item.nextAction,
    };
  }, [item.whereILeftOff, item.nextAction]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = left !== item.whereILeftOff || next !== item.nextAction;
  async function save() {
    setBusy(true);
    setError("");
    try {
      await request({
        type: "patch",
        id: item.id,
        patch: { whereILeftOff: left, nextAction: next },
      });
      onSaved();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function leave(action: () => void) {
    if (!dirty || (await save())) action();
  }
  return (
    <main className={`detail ${statusPresentation[item.status].className}`}>
      <nav className="detail-nav">
        <button disabled={busy} onClick={() => void leave(back)}>
          <ArrowLeft size={16} />
          Your work
        </button>
        <button disabled={busy} onClick={() => void leave(edit)}>
          <Pencil size={15} />
          Edit item
        </button>
      </nav>
      <div className="card-top">
        <span className="category">{item.category}</span>
        <Badge status={item.status} />
      </div>
      <h1>{item.title}</h1>
      <p className="goal">
        {item.goal || "Give this work a purpose by adding a goal."}
      </p>
      <div className="context-flow">
        <label className="context-field">
          <span className="eyebrow">01 / WHERE I LEFT OFF</span>
          <textarea
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            placeholder="What did you finish? What is still on your mind?"
            rows={3}
          />
        </label>
        <span className="flow-arrow">
          <ArrowDown size={18} />
        </span>
        <label className="context-field next-field">
          <span className="eyebrow">02 / NEXT ACTION</span>
          <textarea
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="One concrete step to get moving again…"
            rows={2}
          />
        </label>
      </div>
      <div className="save-row">
        <span>
          {dirty
            ? "Unsaved context — save before closing."
            : "Your context is saved."}
        </span>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save context"}
          <Check size={16} />
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <section className="detail-section">
        <div className="section-heading">
          <h2>Small steps</h2>
          <span>
            {item.checklist.filter((c) => c.completed).length} of{" "}
            {item.checklist.length}
          </span>
        </div>
        {item.checklist.length ? (
          item.checklist.map((check) => (
            <label
              className={`check-row ${check.completed ? "completed" : ""}`}
              key={check.id}
            >
              <input
                type="checkbox"
                checked={check.completed}
                onChange={async (e) => {
                  try {
                    await request({
                      type: "check",
                      id: item.id,
                      checkId: check.id,
                      completed: e.target.checked,
                    });
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
              <span>{check.text}</span>
            </label>
          ))
        ) : (
          <p className="muted">
            No steps yet. Use Edit item to add a checklist.
          </p>
        )}
      </section>
      <section className="detail-section">
        <div className="section-heading">
          <h2>Resources</h2>
          <span>{item.resources.length} saved</span>
        </div>
        {item.resources.map((resource) => (
          <a
            className="resource"
            key={resource.id}
            href={safeUrl(resource.url) ? resource.url : undefined}
            target="_blank"
            rel="noreferrer"
          >
            <span className="resource-icon">
              <ExternalLink size={16} />
            </span>
            <span>
              <strong>{resource.title}</strong>
              <small>
                {safeUrl(resource.url)
                  ? new URL(resource.url).hostname
                  : "Invalid URL"}
              </small>
            </span>
            <ChevronRight size={16} />
          </a>
        ))}
        {!item.resources.length && (
          <p className="muted">
            Save a page from the popup or add a resource in Edit item.
          </p>
        )}
      </section>
      <p className="updated">
        Last updated{" "}
        {new Date(item.updatedAt).toLocaleString([], {
          dateStyle: "medium",
          timeStyle: "short",
        })}
      </p>
    </main>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button type="button" onClick={close} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Editor({
  item,
  close,
  saved,
  deleted,
}: {
  item?: WorkItem;
  close: () => void;
  saved: () => void;
  deleted: () => void;
}) {
  const [draft, setDraft] = useState<Editable>(
    item ? structuredClone(item) : emptyItem(),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  function field<K extends keyof Editable>(key: K, value: Editable[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (item) {
        const patch: Partial<Editable> = {};
        for (const key of Object.keys(emptyItem()) as (keyof Editable)[]) {
          if (JSON.stringify(draft[key]) !== JSON.stringify(item[key]))
            Object.assign(patch, { [key]: draft[key] });
        }
        await request({ type: "patch", id: item.id, patch });
      } else await request({ type: "create", item: draft });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item ? "Edit your work" : "Something to come back to"}
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Title
            <input
              autoFocus
              required
              maxLength={160}
              value={draft.title}
              placeholder="What are you working on?"
              onChange={(e) => field("title", e.target.value)}
            />
          </label>
          <div className="form-columns">
            <label>
              Category
              <input
                required
                maxLength={60}
                list="categories"
                value={draft.category}
                placeholder="e.g. System Design"
                onChange={(e) => field("category", e.target.value)}
              />
            </label>
            <label>
              Status
              <select
                value={draft.status}
                onChange={(e) =>
                  field("status", e.target.value as WorkItem["status"])
                }
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <datalist id="categories">
            <option>System Design</option>
            <option>DSA</option>
            <option>Job Search</option>
            <option>Research</option>
            <option>Personal Project</option>
          </datalist>
          <label>
            Goal
            <textarea
              value={draft.goal}
              onChange={(e) => field("goal", e.target.value)}
              placeholder="What are you hoping to accomplish?"
              rows={2}
            />
          </label>
          <label>
            Where I Left Off
            <textarea
              value={draft.whereILeftOff}
              onChange={(e) => field("whereILeftOff", e.target.value)}
              placeholder="Leave a note for your future self…"
              rows={2}
            />
          </label>
          <label>
            Next Action
            <textarea
              value={draft.nextAction}
              onChange={(e) => field("nextAction", e.target.value)}
              placeholder="The first thing to do when you return"
              rows={2}
            />
          </label>
          <div className="section-heading">
            <h3>Checklist</h3>
            <button
              type="button"
              onClick={() =>
                field("checklist", [
                  ...draft.checklist,
                  { id: crypto.randomUUID(), text: "", completed: false },
                ])
              }
            >
              <Plus size={15} />
              Add step
            </button>
          </div>
          {draft.checklist.map((check, index) => (
            <div className="edit-row" key={check.id}>
              <input
                aria-label={`Step ${index + 1} completed`}
                type="checkbox"
                checked={check.completed}
                onChange={(e) =>
                  field(
                    "checklist",
                    draft.checklist.map((c) =>
                      c.id === check.id
                        ? { ...c, completed: e.target.checked }
                        : c,
                    ),
                  )
                }
              />
              <input
                required
                aria-label={`Step ${index + 1}`}
                placeholder="A small, concrete step"
                value={check.text}
                onChange={(e) =>
                  field(
                    "checklist",
                    draft.checklist.map((c) =>
                      c.id === check.id ? { ...c, text: e.target.value } : c,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label={`Remove step ${index + 1}`}
                onClick={() =>
                  field(
                    "checklist",
                    draft.checklist.filter((c) => c.id !== check.id),
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <div className="section-heading">
            <h3>Resources</h3>
            <button
              type="button"
              onClick={() =>
                field("resources", [
                  ...draft.resources,
                  { id: crypto.randomUUID(), title: "", url: "" },
                ])
              }
            >
              <Plus size={15} />
              Add resource
            </button>
          </div>
          {draft.resources.map((resource, index) => (
            <div className="edit-resource" key={resource.id}>
              <div>
                <input
                  required
                  aria-label={`Resource ${index + 1} title`}
                  placeholder="Resource title"
                  value={resource.title}
                  onChange={(e) =>
                    field(
                      "resources",
                      draft.resources.map((r) =>
                        r.id === resource.id
                          ? { ...r, title: e.target.value }
                          : r,
                      ),
                    )
                  }
                />
                <input
                  required
                  type="url"
                  aria-label={`Resource ${index + 1} URL`}
                  placeholder="https://…"
                  value={resource.url}
                  onChange={(e) =>
                    field(
                      "resources",
                      draft.resources.map((r) =>
                        r.id === resource.id
                          ? { ...r, url: e.target.value }
                          : r,
                      ),
                    )
                  }
                />
              </div>
              <button
                type="button"
                aria-label={`Remove resource ${index + 1}`}
                onClick={() =>
                  field(
                    "resources",
                    draft.resources.filter((r) => r.id !== resource.id),
                  )
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            {item && (
              <button
                className="danger"
                type="button"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={16} />
                Delete
              </button>
            )}
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {busy ? "Saving…" : "Save work item"}
              <ArrowRight size={16} />
            </button>
          </div>
          {confirmDelete && (
            <div className="delete-confirm">
              <p>
                Delete “{item?.title}” and its saved context? This cannot be
                undone.
              </p>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button
                className="danger"
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await request({ type: "delete", id: item!.id });
                    deleted();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Yes, delete work item
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}
function SavePage({
  page,
  items,
  close,
  saved,
}: {
  page: { title: string; url: string };
  items: WorkItem[];
  close: () => void;
  saved: () => void;
}) {
  const [id, setId] = useState(
    items.find((i) => i.status !== "Done")?.id || items[0]?.id || "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id && items.length)
      setId(items.find((i) => i.status !== "Done")?.id || items[0].id);
  }, [items, id]);
  return (
    <Modal
      title="Keep this in context"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="page-preview">
        <BookmarkPlus size={24} />
        <strong>{page.title}</strong>
        <p>{page.url}</p>
      </div>
      <p className="muted">
        Save this resource alongside the work it belongs to.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await request({ type: "resource", id, ...page });
            saved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Work item
          <select required value={id} onChange={(e) => setId(e.target.value)}>
            <option value="" disabled>
              Choose a work item
            </option>
            {[...items].sort(compareWorkItems).map((item) => (
              <option key={item.id} value={item.id}>
                {item.category} — {item.title}
                {item.status === "Done" ? " (Done)" : ""}
              </option>
            ))}
          </select>
        </label>
        {!items.length && (
          <p className="muted">
            Create a work item on the full page first, then save this page
            again.
          </p>
        )}
        {!safeUrl(page.url) && (
          <p className="error">Only http and https pages can be saved.</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!id || busy || !safeUrl(page.url)}
          >
            {busy ? "Saving…" : "Save resource"}
            <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
