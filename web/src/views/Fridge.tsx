import { useState } from "react";
import { DAY, HOUR, NOTE_MAX, fridgeNotes, type Note } from "@aubi/shared";
import { nameOf, pinNote, postNote, setNoteExpiry, useStore } from "../store";
import { ago, span } from "../format";

/** Expiry choices, as ms from now. `undefined` = never expires. */
const EXPIRY: { label: string; ms?: number }[] = [
  { label: "No expiry" },
  { label: "1 hour", ms: HOUR },
  { label: "12 hours", ms: 12 * HOUR },
  { label: "1 day", ms: DAY },
  { label: "3 days", ms: 3 * DAY },
  { label: "1 week", ms: 7 * DAY },
];

const expiryAt = (choice: string, now: number) => {
  const ms = EXPIRY.find((e) => e.label === choice)?.ms;
  return ms === undefined ? undefined : now + ms;
};

/**
 * The Fridge: the shared whiteboard of Notes. Pinned first, then newest; expired Notes drop off as
 * `now` passes their expiry. `onMakeTask` is the hook for turning a Note into a Task (m2/03):
 * when it's given, each Note shows a "Make Task" button.
 */
export function Fridge({ now, onMakeTask, onOpenTask }: { now: number; onMakeTask?: (note: Note) => void; onOpenTask?: (taskId: string) => void }) {
  const all = useStore((s) => s.fridgeNotes);
  const shown = fridgeNotes(all, now);
  const [text, setText] = useState("");
  const [pinned, setPinned] = useState(false);
  const [expiry, setExpiry] = useState(EXPIRY[0].label);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    void postNote(text, { pinned, expiresAt: expiryAt(expiry, Date.now()) });
    setText("");
    setPinned(false);
    setExpiry(EXPIRY[0].label);
  }

  return (
    <div className="fridge">
      <form className="note-new" onSubmit={submit}>
        <textarea
          value={text}
          maxLength={NOTE_MAX}
          placeholder="Leave a Note on the Fridge…"
          aria-label="New Note"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row">
          <label className="check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin</label>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Expires">
            {EXPIRY.map((x) => <option key={x.label}>{x.label}</option>)}
          </select>
          <button className="primary" type="submit" disabled={!text.trim()}>Post</button>
        </div>
      </form>

      <ul className="notes">
        {shown.length === 0 && <li className="empty">The Fridge is empty.</li>}
        {shown.map((n) => <NoteCard key={n.id} note={n} now={now} onMakeTask={onMakeTask} onOpenTask={onOpenTask} />)}
      </ul>
    </div>
  );
}

function NoteCard({ note, now, onMakeTask, onOpenTask }: {
  note: Note; now: number; onMakeTask?: (note: Note) => void; onOpenTask?: (taskId: string) => void;
}) {
  return (
    <li className={`note ${note.pinned ? "pinned" : ""}`}>
      <p className="text">{note.pinned && <span aria-label="Pinned">📌 </span>}{note.text}</p>
      <p className="meta">
        {nameOf(note.by)} · {ago(note.at, now)}
        {note.expiresAt !== undefined && ` · expires in ${span(note.expiresAt - now)}`}
      </p>
      <div className="note-actions">
        <button className="link" onClick={() => void pinNote(note.id, !note.pinned)}>{note.pinned ? "Unpin" : "Pin"}</button>
        <select
          value=""
          aria-label="Change expiry"
          onChange={(e) => void setNoteExpiry(note.id, expiryAt(e.target.value, Date.now()))}
        >
          <option value="" disabled>{note.expiresAt === undefined ? "Set expiry…" : "Change expiry…"}</option>
          {EXPIRY.map((x) => <option key={x.label}>{x.label}</option>)}
        </select>
        {/* m2/03: a Note turned into a Task stays here and links to it; otherwise it offers Make Task. */}
        {note.taskId
          ? <button className="link" onClick={() => onOpenTask?.(note.taskId!)}>✓ Made into a Task</button>
          : onMakeTask && <button className="link" onClick={() => onMakeTask(note)}>Make Task</button>}
      </div>
    </li>
  );
}
