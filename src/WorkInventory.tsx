import { ArrowRight } from "lucide-react";
import type { WorkItem } from "./model";
import { statusPresentation } from "./presentation";

export function Badge({ status }: { status: WorkItem["status"] }) {
  return (
    <span className={`badge ${statusPresentation[status].className}`}>
      <span aria-hidden="true" />
      {status}
    </span>
  );
}

function Progress({ item }: { item: WorkItem }) {
  const done = item.checklist.filter((step) => step.completed).length;
  return (
    <span
      className={`progress-line ${statusPresentation[item.status].className}`}
    >
      <span className="progress-track" aria-hidden="true">
        <span
          style={{
            width: `${item.checklist.length ? (done / item.checklist.length) * 100 : 0}%`,
          }}
        />
      </span>
      <span>
        {item.checklist.length
          ? `${done}/${item.checklist.length} steps`
          : "No steps"}
      </span>
    </span>
  );
}

interface InventoryProps {
  items: WorkItem[];
  resume: (id: string) => void;
}

export function WorkInventory({ items, resume }: InventoryProps) {
  return (
    <main aria-label="Work items" className="inventory">
      {!!items.length && (
        <div className="inventory-head" aria-hidden="true">
          <span>Work item</span>
          <span>Next action</span>
          <span>Status</span>
          <span>Checklist</span>
          <span>Updated</span>
          <span />
        </div>
      )}
      <ul className="work-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={`work-row ${statusPresentation[item.status].className}`}
              onClick={() => resume(item.id)}
              aria-labelledby={`work-title-${item.id}`}
              aria-describedby={`work-next-${item.id}`}
            >
              <span className="row-identity">
                <span
                  className="row-title"
                  id={`work-title-${item.id}`}
                  title={item.title}
                >
                  {item.title}
                </span>
                <span className="row-category" title={item.category}>
                  {item.category}
                </span>
              </span>
              <span
                className={`row-next ${item.nextAction ? "" : "unset"}`}
                id={`work-next-${item.id}`}
                title={item.nextAction || undefined}
              >
                <span className="row-next-label">Next</span>
                <span className="row-next-text">
                  {item.nextAction || "Set one small next step."}
                </span>
              </span>
              <Badge status={item.status} />
              <Progress item={item} />
              <time
                className="row-updated"
                dateTime={item.updatedAt}
                title={`Last updated ${new Date(item.updatedAt).toLocaleString()}`}
              >
                <span className="mobile-updated-label">Updated </span>
                {new Date(item.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </time>
              <ArrowRight className="row-arrow" size={17} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function PopupCards({ items, resume }: InventoryProps) {
  return (
    <main className="cards" aria-label="Active work items">
      {items.map((item) => (
        <article
          className={`work-card ${statusPresentation[item.status].className}`}
          key={item.id}
        >
          <div className="card-top">
            <span className="category">{item.category}</span>
            <Badge status={item.status} />
          </div>
          <button className="title-button" onClick={() => resume(item.id)}>
            <h2>{item.title}</h2>
          </button>
          <Progress item={item} />
          <div className="next-preview">
            <span className="eyebrow">NEXT ACTION</span>
            <p>{item.nextAction || "Set one small next step."}</p>
          </div>
          <button className="resume" onClick={() => resume(item.id)}>
            <span>Resume</span>
            <ArrowRight size={17} />
          </button>
        </article>
      ))}
    </main>
  );
}
