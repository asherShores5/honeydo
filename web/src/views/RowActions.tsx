// A list row's actions (m6/02 swipe left, m6/03): Snooze choices and "Done at…".
import { useState } from "react";
import { DAY, HOUR, fromWall, toWall, type Item } from "@aubi/shared";
import { snooze } from "../store";
import { toLocalInput } from "../format";
import { doneAtFromInput } from "../rowActions";

/** Tomorrow at 08:00 Pacific. */
function tomorrowMorning(now: number) {
  const w = toWall(now);
  return fromWall(w.year, w.month, w.day + 1, 8, 0);
}

export function RowActions({ item, onDone, onClose }: { item: Item; onDone: (at: number) => void; onClose: () => void }) {
  const [doneAt, setDoneAt] = useState<string | null>(null);
  const now = Date.now();
  const check = doneAt === null ? null : doneAtFromInput(doneAt, Date.now());
  const snoozeFor = (until: number) => (snooze(item.id, until), onClose());
  return (
    <div className="sheet small" role="dialog" aria-label={`Actions for ${item.title}`}>
      <div className="sheet-head">
        <button className="link" onClick={onClose}>Cancel</button>
        <strong>{item.title}</strong>
        <span />
      </div>
      <div className="sheet-body">
        {doneAt === null ? (
          <>
            <label>Snooze</label>
            <div className="seg">
              <button onClick={() => snoozeFor(now + 3 * HOUR)}>3 hours</button>
              <button onClick={() => snoozeFor(tomorrowMorning(now))}>Tomorrow 8am</button>
              <button onClick={() => snoozeFor(now + 3 * DAY)}>3 days</button>
            </div>
            {item.snoozedUntil !== undefined && item.snoozedUntil > now && (
              <button className="link" onClick={() => (snooze(item.id, undefined), onClose())}>Unsnooze</button>
            )}
            <button onClick={() => setDoneAt(toLocalInput(now))}>Done at…</button>
          </>
        ) : (
          <>
            <label>Done at
              <input type="datetime-local" value={doneAt} max={toLocalInput(now)} onChange={(e) => setDoneAt(e.target.value)} autoFocus />
            </label>
            {check && !check.ok && <p className="error">{check.error}</p>}
            <button className="strong" disabled={!check?.ok} onClick={() => check?.ok && (onDone(check.at), onClose())}>Mark done</button>
          </>
        )}
      </div>
    </div>
  );
}
