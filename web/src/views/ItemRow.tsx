import { schedule, status, type Item, type Status } from "@aubi/shared";
import { nameOf, type Tag } from "../store";
import { ago, span } from "../format";
import { chipLabel } from "../tags";

export const LABEL: Record<Status, string> = { green: "On track", yellow: "Due soon", red: "Overdue", snoozed: "Snoozed", done: "Done" };

export function ItemRow({ item, now, tags, onOpen, onDone, onSnooze }: {
  item: Item; now: number; tags: Record<string, Tag>; onOpen: () => void; onDone: () => void;
  /** Shown as a Snooze button when given (Tag board, m5/03). */
  onSnooze?: () => void;
}) {
  const st = status(item, now);
  const { nextDue } = schedule(item);
  const due = nextDue === null ? "no due date" : nextDue > now ? `due in ${span(nextDue - now)}` : `overdue ${span(now - nextDue)}`;
  return (
    <li className={`item ${st}`}>
      <button className="body" onClick={onOpen}>
        <span className="dot" aria-label={LABEL[st]} />
        <span className="title">
          {item.title}
          {item.visibility !== "shared" && <span title="Private"> 🔒</span>}
          {item.severity && <span className={`sev ${item.severity}`}>{item.severity}</span>}
        </span>
        <span className="meta">
          {st === "snoozed" ? `snoozed ${span(item.snoozedUntil! - now)}` : due}
          {item.lastDoneAt !== undefined && ` · last ${ago(item.lastDoneAt, now)}${item.lastDoneBy ? ` by ${nameOf(item.lastDoneBy)}` : ""}`}
          {item.assigneeId && ` · for ${nameOf(item.assigneeId)}`}
        </span>
        {item.tags.length > 0 && (
          <span className="tags">{item.tags.map((t) => tags[t] && <span key={t}>{chipLabel(tags[t], tags)}</span>)}</span>
        )}
      </button>
      {onSnooze && <button className="snooze" onClick={onSnooze} aria-label={`Snooze ${item.title} 1 day`}>💤</button>}
      <button className="done" onClick={onDone} aria-label={`Mark ${item.title} done`}>✓</button>
    </li>
  );
}
