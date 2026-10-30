import { useEffect, useState } from "react";
import { COMMENT_MAX, DAY, HOUR, fromWall, type Item, type Recurrence, type Severity } from "@aubi/shared";
import { addComment, loadComments, loadCompletions, nameOf, saveItem, snooze, toInput, undoCompletion, useStore, completeItem } from "../store";
import { ago, fromLocalInput, newId, span, toLocalInput, when } from "../format";
import { groupTags } from "../tags";
import { assigneeWhenPrivate } from "../privateAssignee";
import type { TaskDraft } from "../noteToTask";
import { defaultWarnFor, warnFromInput, warnToInput, type WarnUnit } from "../warnWindow";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
type Mode = "interval" | "weekly" | "monthly" | "once";

/**
 * `prefill` pre-fills a new item as a one-off Task (m2/03: "Make Task" on a Note); `onSaved` hears
 * which item was saved, after its putItem is queued.
 */
export function Editor({ item, prefill, onSaved, onClose }: {
  item?: Item;
  prefill?: TaskDraft;
  onSaved?: (saved: Pick<Item, "id" | "kind" | "visibility">) => void;
  onClose: () => void;
}) {
  const me = useStore((s) => s.me!);
  const profiles = useStore((s) => s.profiles);
  const tags = useStore((s) => s.tags);
  const live = useStore((s) => (item ? s.items[item.id] : undefined)) ?? item;

  const rec = item?.recurrence;
  const [title, setTitle] = useState(item?.title ?? prefill?.title ?? "");
  const [mode, setMode] = useState<Mode>(item?.kind === "task" || (!item && prefill) ? "once" : rec?.type === "calendar" ? rec.freq : "interval");
  const [every, setEvery] = useState(rec?.type === "interval" ? rec.every : 3);
  const [unit, setUnit] = useState<"hours" | "days" | "weeks">(rec?.type === "interval" ? rec.unit : "days");
  const [weekdays, setWeekdays] = useState<number[]>(rec?.type === "calendar" && rec.freq === "weekly" ? [...rec.byWeekday] : [new Date().getDay()]);
  const [monthDays, setMonthDays] = useState(rec?.type === "calendar" && rec.freq === "monthly" ? rec.byMonthDay.join(", ") : "1");
  const [at, setAt] = useState(rec?.type === "calendar" ? rec.at ?? "20:00" : "20:00");
  const [dueAt, setDueAt] = useState(item?.dueAt ? toLocalInput(item.dueAt) : "");
  const [selTags, setSelTags] = useState(new Set(item?.tags ?? []));
  const [assignee, setAssignee] = useState(item?.assigneeId ?? "");
  const [severity, setSeverity] = useState<Severity | "">(item?.severity ?? "");
  // A new item (a prefill from a Note included) starts shared.
  const [isPrivate, setPrivate] = useState(item ? item.visibility !== "shared" : false);
  const [notes, setNotes] = useState(item?.notes ?? prefill?.notes ?? "");
  const [lastDone, setLastDone] = useState("");
  const [warn, setWarn] = useState(warnToInput(item?.warnWindow));
  const [history, setHistory] = useState<{ at: number; by: string; note?: string }[]>();
  // Comments (M2): loaded on open, then kept live by onCommentChange through the store.
  const comments = useStore((s) => (item ? s.comments[item.id] : undefined));
  const [draft, setDraft] = useState("");
  const [draftId, setDraftId] = useState(newId);
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState("");

  useEffect(() => {
    if (item) loadComments(item.id).catch(() => setCommentError("Couldn't load comments."));
  }, [item]);

  async function postComment() {
    if (!item || !draft.trim() || posting) return;
    setPosting(true);
    setCommentError("");
    try {
      await addComment(item.id, draftId, draft.trim());
      setDraft("");
      setDraftId(newId());
    } catch (e) {
      setCommentError(`Couldn't post: ${(e as Error).message.replace(/^\w+Error: /, "")}`);
    } finally {
      setPosting(false);
    }
  }

  useEffect(() => {
    if (item) loadCompletions(item.id).then(setHistory, () => setHistory([]));
  }, [item, live?.lastDoneAt]);

  function recurrence(m: Exclude<Mode, "once">): Recurrence {
    if (m === "interval") return { type: "interval", every: Math.max(1, Math.round(every)), unit };
    if (m === "weekly") return { type: "calendar", freq: "weekly", byWeekday: [...weekdays].sort(), at };
    const days = monthDays.split(/[ ,]+/).map(Number).filter((d) => d >= 1 && d <= 31);
    return { type: "calendar", freq: "monthly", byMonthDay: days.length ? days : [1], at };
  }

  function togglePrivate(on: boolean) {
    setPrivate(on);
    if (on) setAssignee(assigneeWhenPrivate(assignee, me.userId));
  }

  const warnCheck = mode === "once" ? ({ ok: true, ms: item?.warnWindow } as const) : warnFromInput(warn.value, warn.unit, recurrence(mode));
  const valid = title.trim() && (mode !== "weekly" || weekdays.length > 0) && warnCheck.ok;

  function save() {
    const id = item?.id ?? newId();
    const common = {
      id,
      title: title.trim(),
      notes: notes.trim() || undefined,
      tags: [...selTags],
      assigneeId: (isPrivate ? assigneeWhenPrivate(assignee, me.userId) : assignee) || undefined,
      visibility: (isPrivate ? `private:${me.userId}` : "shared") as Item["visibility"],
      severity: severity || undefined,
      warnWindow: warnCheck.ok ? warnCheck.ms : undefined,
      snoozedUntil: item?.snoozedUntil,
      archived: live?.archived ?? false, // live: undoing a finished Task's Completion un-Archives it
    };
    saveItem(
      mode === "once"
        ? { ...common, kind: "task", recurrence: undefined, dueAt: fromLocalInput(dueAt) }
        : { ...common, kind: "chore", recurrence: recurrence(mode), dueAt: undefined },
    );
    // New chores can start from "last done": otherwise they're due immediately.
    const ld = fromLocalInput(lastDone);
    if (!item && ld && mode !== "once") completeItem(id, ld);
    onSaved?.({ id, kind: mode === "once" ? "task" : "chore", visibility: common.visibility });
    onClose();
  }

  const groups = groupTags(tags);

  return (
    <div className="sheet" role="dialog">
      <div className="sheet-head">
        <button className="link" onClick={onClose}>Cancel</button>
        <strong>{item ? "Edit" : "New"}</strong>
        <button className="link strong" disabled={!valid} onClick={save}>Save</button>
      </div>
      <div className="sheet-body">
        <input className="title-input" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!item} maxLength={200} />

        <label>Repeats
          <div className="seg">
            {(["interval", "weekly", "monthly", "once"] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                {{ interval: "Every N", weekly: "Weekly", monthly: "Monthly", once: "One-off" }[m]}
              </button>
            ))}
          </div>
        </label>

        {mode === "interval" && (
          <div className="row">
            Every <input type="number" min={1} max={1000} value={every} onChange={(e) => setEvery(+e.target.value)} className="num" />
            <select value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
              <option value="hours">hours</option><option value="days">days</option><option value="weeks">weeks</option>
            </select>
            <span className="hint">after it's done</span>
          </div>
        )}
        {mode === "weekly" && (
          <div className="row">
            {WEEKDAYS.map((d, i) => (
              <button key={i} className={`day ${weekdays.includes(i) ? "on" : ""}`}
                onClick={() => setWeekdays(weekdays.includes(i) ? weekdays.filter((x) => x !== i) : [...weekdays, i])}>{d}</button>
            ))}
            at <input type="time" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
        )}
        {mode === "monthly" && (
          <div className="row">
            Day(s) <input value={monthDays} onChange={(e) => setMonthDays(e.target.value)} className="num wide" placeholder="1, 15" />
            at <input type="time" value={at} onChange={(e) => setAt(e.target.value)} />
          </div>
        )}
        {mode === "once" && (
          <label>Due <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></label>
        )}
        {mode !== "once" && (
          <div className="row">
            Turn yellow
            <input type="number" min={1} className="num" value={warn.value} placeholder={span(defaultWarnFor(recurrence(mode), Date.now()))}
              onChange={(e) => setWarn({ ...warn, value: e.target.value })} aria-label="Warn window" />
            <select value={warn.unit} onChange={(e) => setWarn({ ...warn, unit: e.target.value as WarnUnit })}>
              <option value="hours">hours</option><option value="days">days</option>
            </select>
            <span className="hint">before it's due{warn.value ? "" : ` (default ${span(defaultWarnFor(recurrence(mode), Date.now()))})`}</span>
            {!warnCheck.ok && <span className="error">{warnCheck.error}</span>}
          </div>
        )}
        {!item && mode !== "once" && (
          <label>Last done <small>(optional — otherwise it's due now)</small>
            <input type="datetime-local" value={lastDone} max={toLocalInput(Date.now())} onChange={(e) => setLastDone(e.target.value)} />
          </label>
        )}

        <label>Tags</label>
        {[...groups].map(([g, ts]) => (
          <div className="group" key={g}>
            <span>{g}</span>
            {ts.map((t) => (
              <button key={t.id} className={`chip ${selTags.has(t.id) ? "on" : ""}`}
                onClick={() => { const s = new Set(selTags); s.has(t.id) ? s.delete(t.id) : s.add(t.id); setSelTags(s); }}>{t.name}</button>
            ))}
          </div>
        ))}

        {!isPrivate && (
          <label>For
            <div className="seg">
              <button className={!assignee ? "on" : ""} onClick={() => setAssignee("")}>Either</button>
              {Object.values(profiles).map((p) => (
                <button key={p.userId} className={assignee === p.userId ? "on" : ""} onClick={() => setAssignee(p.userId)}>{nameOf(p.userId)}</button>
              ))}
            </div>
          </label>
        )}

        <label>Overdue alerts
          <div className="seg">
            {(["", "low", "medium", "high"] as const).map((s) => (
              <button key={s} className={severity === s ? "on" : ""} onClick={() => setSeverity(s)}>
                {{ "": "Default", low: "Low 1×", medium: "Med 2×", high: "High 3×" }[s]}
              </button>
            ))}
          </div>
          <small>Dings per day while overdue.</small>
        </label>

        <label className="check"><input type="checkbox" checked={isPrivate} onChange={(e) => togglePrivate(e.target.checked)} /> Private (only you can see it)</label>
        <label>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={5000} /></label>

        {item && live && (
          <>
            <div className="row actions">
              <button onClick={() => (snooze(item.id, Date.now() + DAY), onClose())}>Snooze 1 day</button>
              {live.snoozedUntil && <button onClick={() => snooze(item.id, undefined)}>Unsnooze</button>}
              <button onClick={() => (snooze(item.id, Date.now() + 3 * HOUR), onClose())}>Snooze 3h</button>
            </div>
            <h3>History</h3>
            <ul className="history">
              {history === undefined && <li>Loading…</li>}
              {history?.length === 0 && <li>Never done.</li>}
              {history?.map((c) => (
                <li key={c.at}>
                  {when(c.at)} · {nameOf(c.by)} <small>({ago(c.at)})</small>
                  {c.note && <q>{c.note}</q>}
                  <button className="link" onClick={() => (undoCompletion(item.id, c.at), setHistory(history.filter((h) => h.at !== c.at)))}>remove</button>
                </li>
              ))}
            </ul>
            <h3>Comments</h3>
            <ul className="history comments">
              {comments === undefined && !commentError && <li>Loading…</li>}
              {comments?.length === 0 && <li>No comments yet.</li>}
              {comments?.map((c) => (
                <li key={c.id}>
                  <b>{nameOf(c.by)}</b> <q>{c.text}</q> <small>({ago(c.at)})</small>
                </li>
              ))}
            </ul>
            <div className="row">
              <input placeholder="Add a comment" value={draft} maxLength={COMMENT_MAX} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void postComment()} />
              <button disabled={posting || !draft.trim()} onClick={() => void postComment()}>Post</button>
            </div>
            {commentError && <small className="error">{commentError}</small>}
            {!live.archived && <button className="danger" onClick={() => (saveItem({ ...toInput(live), archived: true }), onClose())}>Archive</button>}
          </>
        )}
      </div>
    </div>
  );
}
