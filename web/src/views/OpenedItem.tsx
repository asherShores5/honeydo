import { schedule, type Item } from "@aubi/shared";
import { nameOf, useStore } from "../store";
import { ago, span } from "../format";
import { openItem } from "../openItem";

/**
 * The item a tapped Ding opened (m4/05). iOS has no notification buttons, so this is where
 * "Mark done" lives: one big Done, through the normal completeItem / outbox path.
 */
export function OpenedItem({ itemId, onDone, onEdit, onClose }: { itemId: string; onDone: (item: Item) => void; onEdit: (item: Item) => void; onClose: () => void }) {
  const me = useStore((s) => s.me!);
  const items = useStore((s) => s.items);
  const now = Date.now();
  const opened = openItem(itemId, items, me.userId, now);
  if (!opened) return null;
  const { item, canDone } = opened;
  const { nextDue } = schedule(item);
  const due = nextDue === null ? "No due date" : nextDue > now ? `Due in ${span(nextDue - now)}` : `Overdue ${span(now - nextDue)}`;

  return (
    <div className="sheet" role="dialog" aria-label={item.title}>
      <div className="sheet-head">
        <button onClick={onClose}>Close</button>
        <button onClick={() => onEdit(item)}>Edit</button>
      </div>
      <div className="sheet-body">
        <h2>{item.title}{item.visibility !== "shared" && <span title="Private"> 🔒</span>}</h2>
        <p className="meta">
          {canDone ? due : "Already done"}
          {item.lastDoneAt !== undefined && ` · last ${ago(item.lastDoneAt, now)}${item.lastDoneBy ? ` by ${nameOf(item.lastDoneBy)}` : ""}`}
          {item.assigneeId && ` · for ${nameOf(item.assigneeId)}`}
        </p>
        {item.notes && <p>{item.notes}</p>}
        {canDone && <button className="primary big" onClick={() => onDone(item)}>Done</button>}
      </div>
    </div>
  );
}
