import { useRef, useState, type PointerEvent } from "react";
import { schedule, status, type Item, type Status } from "@aubi/shared";
import { nameOf, type Tag } from "../store";
import { ago, span } from "../format";
import { chipLabel } from "../tags";
import { swipeAction } from "../rowActions";

export const LABEL: Record<Status, string> = { green: "On track", yellow: "Due soon", red: "Overdue", snoozed: "Snoozed", done: "Done" };

/** Sideways drag past this (px) locks the row into a swipe instead of a scroll. */
const SWIPE_LOCK_PX = 10;

export function ItemRow({ item, now, tags, onOpen, onDone, onSnooze, onActions }: {
  item: Item; now: number; tags: Record<string, Tag>; onOpen: () => void; onDone: () => void;
  /** Shown as a Snooze button when given (Tag board, m5/03). */
  onSnooze?: () => void;
  /** Snooze choices and "Done at…" (m6/02, m6/03): swipe left, or the ⋯ button. */
  onActions?: () => void;
}) {
  // Swipe right = Done, left = actions (m6/02). Vertical drags stay native scrolls (touch-action: pan-y).
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  const justSwiped = useRef(false);
  const [dx, setDx] = useState(0);
  const reset = () => ((start.current = null), (swiping.current = false), setDx(0));
  const down = (e: PointerEvent) => void (start.current = { x: e.clientX, y: e.clientY });
  const move = (e: PointerEvent<HTMLLIElement>) => {
    if (!start.current) return;
    const [mx, my] = [e.clientX - start.current.x, e.clientY - start.current.y];
    if (!swiping.current && Math.abs(mx) > SWIPE_LOCK_PX && Math.abs(mx) > Math.abs(my)) {
      swiping.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (swiping.current) setDx(onActions || mx > 0 ? mx : 0);
  };
  const up = (e: PointerEvent) => {
    if (!start.current) return;
    const action = swiping.current ? swipeAction(e.clientX - start.current.x, e.clientY - start.current.y) : null;
    if (swiping.current) {
      // Swallow the click this release fires, but no later ones.
      justSwiped.current = true;
      setTimeout(() => void (justSwiped.current = false));
    }
    reset();
    if (action === "done") onDone();
    else if (action === "snooze") onActions?.();
  };

  const st = status(item, now);
  const { nextDue } = schedule(item);
  const due = nextDue === null ? "no due date" : nextDue > now ? `due in ${span(nextDue - now)}` : `overdue ${span(now - nextDue)}`;
  return (
    <li
      className={`item ${st}${dx ? " swiping" : ""}`}
      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={reset}
      onClickCapture={(e) => justSwiped.current && (e.stopPropagation(), e.preventDefault())}
    >
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
      {onActions && <button className="more" onClick={onActions} aria-label={`More for ${item.title}`}>⋯</button>}
      {onSnooze && <button className="snooze" onClick={onSnooze} aria-label={`Snooze ${item.title} 1 day`}>💤</button>}
      <button className="done" onClick={onDone} aria-label={`Mark ${item.title} done`}>✓</button>
    </li>
  );
}
