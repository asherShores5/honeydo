// M5 Views: Today, Calendar, Tag board, History & stats, and Saved views. Each one renders a
// pure derivation from @aubi/shared over the snapshot (plus Completions where it needs them).
import { useEffect, useMemo, useState } from "react";
import {
  TIME_OF_DAY, calendarDays, endOfDay, fromWall, historyStats, isActive, sortItems, tagBoard, toWall, todayGroups,
  type Completion, type Item, type SavedView, type TagColumn, type ViewLayout,
} from "@aubi/shared";
import { loadCompletionsOf, nameOf, useStore, type Tag } from "../store";
import { span, when } from "../format";
import { groupTags } from "../tags";
import { ItemRow } from "./ItemRow";

export type BuiltinView = "today" | "calendar" | "board" | "stats";
export const BUILTIN_VIEWS: [BuiltinView, string][] = [["today", "Today"], ["calendar", "Calendar"], ["board", "Tag board"], ["stats", "History & stats"]];

interface Actions {
  onOpen: (item: Item) => void;
  onDone: (item: Item) => void;
  /** Snooze choices and "Done at…" (swipe left or ⋯). */
  onActions: (item: Item) => void;
}

/** Every Completion of these items since `since`, reloaded when the set or `since` changes. */
function useCompletions(itemIds: string[], since: number): Completion[] | null {
  const key = [...itemIds].sort().join(",");
  const [list, setList] = useState<Completion[] | null>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    loadCompletionsOf(key ? key.split(",") : [], 50, since).then((c) => live && setList(c), () => live && setList([]));
    return () => void (live = false);
  }, [key, since]);
  return list;
}

function Columns({ columns, now, tags, actions, untaggedLabel }: {
  columns: TagColumn[]; now: number; tags: Record<string, Tag>; actions: Actions;
  /** Heading of the column for items with no Tag in the group. */
  untaggedLabel: string;
}) {
  return (
    <>
      {columns.map((c) => (
        <section key={c.tag?.id ?? "none"} className="column">
          <h3>{c.tag?.name ?? untaggedLabel} <b>{c.items.length}</b></h3>
          <ul className="items">
            {c.items.length === 0 && <li className="empty">Nothing here.</li>}
            {c.items.map((i) => (
              <ItemRow key={i.id} item={i} now={now} tags={tags} onOpen={() => actions.onOpen(i)} onDone={() => actions.onDone(i)} onActions={() => actions.onActions(i)} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function TodayView({ items, now, actions }: { items: Item[]; now: number; actions: Actions }) {
  const tags = useStore((s) => s.tags);
  const groups = useMemo(() => todayGroups(items, Object.values(tags), now), [items, tags, now]);
  if (!groups.length) return <p className="empty">Nothing due today 🎉</p>;
  return <Columns columns={groups} now={now} tags={tags} actions={actions} untaggedLabel={`No ${TIME_OF_DAY.toLowerCase()}`} />;
}

export function BoardView({ items, now, actions, group }: { items: Item[]; now: number; actions: Actions; group?: string }) {
  const tags = useStore((s) => s.tags);
  const groups = [...groupTags(tags).keys()];
  const [picked, setPicked] = useState(group ?? groups.find((g) => g === "Locale") ?? groups[0]);
  const current = group ?? picked;
  const columns = useMemo(() => (current ? tagBoard(items, Object.values(tags), current, now) : []), [items, tags, current, now]);
  return (
    <div className="board">
      <div className="group">
        {groups.map((g) => (
          <button key={g} className={`chip ${g === current ? "on" : ""}`} onClick={() => setPicked(g)}>{g}</button>
        ))}
      </div>
      {!current ? <p className="empty">Add some Tags first.</p> : (
        <div className="columns">
          <Columns columns={columns} now={now} tags={tags} actions={actions} untaggedLabel={`No ${current.toLowerCase()}`} />
        </div>
      )}
    </div>
  );
}

const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" });

export function CalendarView({ items, now, actions }: { items: Item[]; now: number; actions: Actions }) {
  const [offset, setOffset] = useState(0); // weeks from this one
  const w = toWall(now);
  const start = fromWall(w.year, w.month, w.day - 1 + offset * 7); // yesterday, so recent Completions show
  const completions = useCompletions(items.map((i) => i.id), start);
  const days = useMemo(() => calendarDays(items, completions ?? [], start, 8, now), [items, completions, start]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  return (
    <div className="calendar">
      <div className="group">
        <button className="chip" onClick={() => setOffset(offset - 1)}>◀ Earlier</button>
        {offset !== 0 && <button className="chip" onClick={() => setOffset(0)}>This week</button>}
        <button className="chip" onClick={() => setOffset(offset + 1)}>Later ▶</button>
      </div>
      {days.map((d) => (
        <section key={d.start} className={`cal-day ${d.start <= now && now < endOfDay(d.start) ? "today" : ""}`}>
          <h3>{dayLabel.format(new Date(d.start))}</h3>
          <ul className="feed">
            {d.entries.length === 0 && <li className="empty">—</li>}
            {d.entries.map((e) => (
              <li key={`${e.kind}-${e.itemId}-${e.at}`} className={e.kind}>
                <button className="link" onClick={() => byId.get(e.itemId) && actions.onOpen(byId.get(e.itemId)!)}>
                  {e.kind === "done" ? "✓ " : ""}<i>{e.title}</i>
                </button>
                {e.kind === "done" ? <time>{nameOf(e.by)}</time> : <time>{when(e.at).split(", ").pop()}</time>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {completions === null && <p className="empty">Loading History…</p>}
    </div>
  );
}

const PERIODS: [string, number][] = [["7 days", 7], ["30 days", 30], ["90 days", 90]];

export function StatsView({ items, now }: { items: Item[]; now: number }) {
  const me = useStore((s) => s.me!);
  const profiles = useStore((s) => s.profiles);
  const [days, setDays] = useState(30);
  // Whole Pacific days: the period starts at midnight `days - 1` days before today.
  const w = toWall(now);
  const from = fromWall(w.year, w.month, w.day - days + 1);
  const completions = useCompletions(items.map((i) => i.id), from);
  const members = useMemo(() => [...new Set([me.userId, ...Object.keys(profiles)])], [me.userId, profiles]);
  const stats = useMemo(() => historyStats(items, completions ?? [], members, from, now + 1), [items, completions, members, now, from]);
  if (completions === null) return <p className="empty">Loading History…</p>;
  const total = stats.byMember.reduce((n, m) => n + m.count, 0);
  return (
    <div className="stats">
      <div className="group">
        {PERIODS.map(([label, d]) => <button key={d} className={`chip ${d === days ? "on" : ""}`} onClick={() => setDays(d)}>{label}</button>)}
      </div>
      <h3>Who did what</h3>
      <ul className="feed">
        {stats.byMember.map((m) => (
          <li key={m.userId}>
            <b>{m.userId === me.userId ? "You" : nameOf(m.userId)}</b> {m.count} done
            <time>{total ? `${Math.round((m.count / total) * 100)}%` : "—"}</time>
          </li>
        ))}
      </ul>
      <h3>Target vs actual</h3>
      <ul className="feed">
        {stats.chores.length === 0 && <li className="empty">No interval chores.</li>}
        {stats.chores.map((c) => (
          <li key={c.itemId}>
            <i>{c.title}</i> every {span(c.targetMs)}
            <time>{c.actualMs === null ? `${c.count} done` : `actually every ${span(c.actualMs)}`}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A Saved view's items: its filter applied, in its sort, shown in its layout. */
export function SavedViewBody({ view, items, now, actions, filter }: {
  view: SavedView; items: Item[]; now: number; actions: Actions;
  filter: (item: Item, view: SavedView) => boolean;
}) {
  const tags = useStore((s) => s.tags);
  const matching = useMemo(() => items.filter((i) => filter(i, view)), [items, view, filter]);
  const layout: ViewLayout = view.layout ?? "list";
  if (layout === "today") return <TodayView items={matching} now={now} actions={actions} />;
  if (layout === "calendar") return <CalendarView items={matching} now={now} actions={actions} />;
  if (layout === "board") return <BoardView items={matching} now={now} actions={actions} group={view.boardGroup} />;
  const list = sortItems(matching.filter((i) => isActive(i, now)), view.sort ?? "urgency", now);
  return (
    <ul className="items">
      {list.length === 0 && <li className="empty">No matches for this view.</li>}
      {list.map((i) => <ItemRow key={i.id} item={i} now={now} tags={tags} onOpen={() => actions.onOpen(i)} onDone={() => actions.onDone(i)} onActions={() => actions.onActions(i)} />)}
    </ul>
  );
}

const LAYOUT_LABEL: Record<ViewLayout, string> = { list: "List", today: "Today", board: "Tag board", calendar: "Calendar" };

/** My Saved views: pin as a tab, change layout or sort, delete. Saving needs a connection. */
export function SavedViewsManager({ views, onChange }: { views: SavedView[]; onChange: (views: SavedView[]) => void }) {
  const tags = useStore((s) => s.tags);
  const groups = [...groupTags(tags).keys()];
  const edit = (id: string, patch: Partial<SavedView>) => onChange(views.map((v) => {
    if (v.id !== id) return v;
    const next = { ...v, ...patch };
    if (next.layout === "board" && !next.boardGroup) next.boardGroup = groups[0];
    if (next.layout !== "board") delete next.boardGroup;
    return next;
  }));
  if (!views.length) return <p className="hint">No Saved views yet. Set a filter on On track, then tap “Save view”.</p>;
  return (
    <ul className="saved-views">
      {views.map((v) => (
        <li key={v.id}>
          <b>{v.name}</b>
          <select value={v.layout ?? "list"} onChange={(e) => edit(v.id, { layout: e.target.value as ViewLayout })} aria-label={`${v.name} layout`}>
            {(Object.keys(LAYOUT_LABEL) as ViewLayout[]).map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}
          </select>
          {(v.layout ?? "list") === "list" && (
            <select value={v.sort ?? "urgency"} onChange={(e) => edit(v.id, { sort: e.target.value as SavedView["sort"] })} aria-label={`${v.name} sort`}>
              <option value="urgency">Due date</option><option value="priority">Priority</option><option value="title">A–Z</option><option value="lastDone">Longest since done</option>
            </select>
          )}
          {v.layout === "board" && (
            <select value={v.boardGroup} onChange={(e) => edit(v.id, { boardGroup: e.target.value })} aria-label={`${v.name} Tag group`}>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          <button className={`chip ${v.pinned ? "on" : ""}`} onClick={() => edit(v.id, { pinned: !v.pinned })}>{v.pinned ? "Pinned" : "Pin"}</button>
          <button className="link" onClick={() => onChange(views.filter((x) => x.id !== v.id))}>Delete</button>
        </li>
      ))}
    </ul>
  );
}
