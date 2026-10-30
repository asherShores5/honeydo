import { useEffect, useMemo, useState } from "react";
import { readAlertPrefs, type Completion } from "@aubi/shared";
import { loadCompletionsOf, useStore } from "../store";
import { cardDismissed, cardWindow, dismissCard, handoffCard, itemsDoneSince, withPending } from "../handoffCard";

/** Today's Handoff (m2/04): what the push said, kept current, until dismissed or the next one. */
export function HandoffCard({ now }: { now: number }) {
  const me = useStore((s) => s.me!);
  const items = useStore((s) => s.items);
  const profiles = useStore((s) => s.profiles);
  const outbox = useStore((s) => s.outbox);
  const { handoffAt } = readAlertPrefs(me.alertPrefs);
  const lastHandoff = me.lastHandoffAt != null ? { at: me.lastHandoffAt, since: me.lastHandoffSince } : undefined;
  const { since } = cardWindow(handoffAt, now, lastHandoff);
  const [dismissed, setDismissed] = useState(() => cardDismissed(localStorage, me.userId, handoffAt, now));
  const [fetched, setFetched] = useState<Completion[]>([]);

  useEffect(() => setDismissed(cardDismissed(localStorage, me.userId, handoffAt, now)), [me.userId, handoffAt, now]);

  // Refetch only when an item in the window is done or undone, or a queued op reaches the server.
  const list = Object.values(items);
  const ids = itemsDoneSince(list, since);
  const key = ids.map((id) => `${id}@${items[id].lastDoneAt}`).sort().join(",") + `#${outbox.length}`;
  useEffect(() => {
    if (dismissed) return;
    let live = true;
    loadCompletionsOf(ids).then((c) => live && setFetched(c), () => {}); // offline: keep the last ones
    return () => void (live = false);
  }, [key, dismissed]);

  const content = useMemo(
    () => handoffCard({ userId: me.userId, items: list, completions: withPending(fetched, outbox, me.userId), profiles, now, lastHandoff }),
    [items, fetched, outbox, profiles, me.userId, me.lastHandoffAt, me.lastHandoffSince, now],
  );

  if (dismissed) return null;
  const section = (label: string, entries: string[]) =>
    entries.length > 0 && (
      <p>
        <b>{label}</b> {entries.join(", ")}
      </p>
    );
  return (
    <section className="card handoff" aria-label="Handoff">
      <div className="handoff-head">
        <h2>Handoff</h2>
        <button className="link" onClick={() => (dismissCard(localStorage, me.userId, handoffAt, now), setDismissed(true))}>
          Dismiss
        </button>
      </div>
      {section("Done:", content.done.map((d) => `${d.title} (${d.byName})`))}
      {section("Overdue:", content.overdue.map((d) => d.title))}
      {section("Due before next Handoff:", content.dueBeforeNext.map((d) => d.title))}
      {!content.done.length && !content.overdue.length && !content.dueBeforeNext.length && <p className="empty">{content.lines[0]}</p>}
    </section>
  );
}
