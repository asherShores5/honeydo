import { useEffect, useMemo, useRef, useState } from "react";
import { VIEW_NAME_MAX, status, unreadActivity, urgency, type Item, type SavedView } from "@aubi/shared";
import { completeItem, markActivitySeen, nameOf, saveViews as saveMyViews, toast, undoCompletion, useStore, type Tag, type Who } from "../store";
import { ago, newId } from "../format";
import { chipLabel, groupTags, matchesTags } from "../tags";
import { Editor } from "./Editor";
import { Settings } from "./Settings";
import { finishedTasks } from "../finished";
import { openItem } from "../openItem";
import { consumePendingItem, usePendingItem } from "../openRequests";
import { OpenedItem } from "./OpenedItem";
import { HandoffCard } from "./HandoffCard";
import { Fridge } from "./Fridge";
import type { Note } from "@aubi/shared";
import { markNoteTasked } from "../store";
import { linksNote, taskDraft } from "../noteToTask";
import { ItemRow, LABEL } from "./ItemRow";
import { QuickAdd } from "./QuickAdd";
import { RowActions } from "./RowActions";
import { BUILTIN_VIEWS, BoardView, CalendarView, SavedViewBody, SavedViewsManager, StatsView, TodayView, type BuiltinView } from "./Views";

/** `view:<id>` is a pinned Saved view (m5/05). */
type Tab = "ontrack" | "overdue" | "finished" | "activity" | "fridge" | "views" | `view:${string}`;

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    const vis = () => document.visibilityState === "visible" && setNow(Date.now());
    document.addEventListener("visibilitychange", vis);
    return () => (clearInterval(t), document.removeEventListener("visibilitychange", vis));
  }, [ms]);
  return now;
}

/** Tag filter (OR within a group, AND across groups) plus the Who filter. */
function matches(item: Item, selected: Set<string>, tags: Record<string, Tag>, who: Who, me: string) {
  if (!matchesTags(item, selected, tags)) return false;
  if (who === "mine") return item.assigneeId === me;
  if (who === "partner") return !!item.assigneeId && item.assigneeId !== me;
  if (who === "unassigned") return !item.assigneeId;
  return true;
}

export function Home() {
  const me = useStore((s) => s.me!);
  const items = useStore((s) => s.items);
  const tags = useStore((s) => s.tags);
  const feed = useStore((s) => s.feed);
  const online = useStore((s) => s.online);
  const live = useStore((s) => s.live);
  const pending = useStore((s) => s.outbox.length);
  const toastMsg = useStore((s) => s.toast);
  const now = useNow();

  const [tab, setTab] = useState<Tab>("ontrack");
  const [selected, setSelected] = useState(new Set<string>(me.defaultView?.tags ?? []));
  const [who, setWho] = useState<Who>(me.defaultView?.who ?? "anyone");
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [settings, setSettings] = useState(false);
  const [undo, setUndo] = useState<{ itemId: string; at: number; title: string } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [rowActions, setRowActions] = useState<Item | null>(null);
  const [builtin, setBuiltin] = useState<BuiltinView>("today");
  const savedViews = me.savedViews ?? [];
  const pinned = savedViews.filter((v) => v.pinned);
  const activeView = tab.startsWith("view:") ? savedViews.find((v) => `view:${v.id}` === tab) : undefined;
  // A pinned view deleted or unpinned on another device: fall back to On track.
  useEffect(() => {
    if (tab.startsWith("view:") && !activeView?.pinned) setTab("ontrack");
  }, [tab, activeView]);

  function saveViews(next: SavedView[]) {
    saveMyViews({ savedViews: next }).catch(() => toast("Couldn't save your views. Check your connection."));
  }
  function saveCurrentAsView() {
    const name = window.prompt("Name this view")?.trim();
    if (!name) return;
    const view: SavedView = { id: newId(), name: name.slice(0, VIEW_NAME_MAX), tags: [...selected], who, sort: "urgency", layout: "list", pinned: true };
    saveViews([...savedViews, view]);
    setTab(`view:${view.id}`);
  }
  const viewFilter = (i: Item, v: SavedView) => matches(i, new Set(v.tags), tags, v.who, me.userId);
  // m2/03: "Make Task" on a Note opens the Editor pre-filled; a Note's Task opens like a Ding's item.
  const [fromNote, setFromNote] = useState<Note | null>(null);
  function openTask(taskId: string) {
    if (openItem(taskId, items, me.userId, Date.now())) setOpened(taskId);
    else toast("That Task isn't here anymore.");
  }

  // A tapped Ding asks to open its item (?item= on launch, or a worker message if already open).
  const pendingItem = usePendingItem();
  useEffect(() => {
    if (!pendingItem) return;
    consumePendingItem();
    if (openItem(pendingItem, items, me.userId, Date.now())) {
      setEditing(null);
      setSettings(false);
      setOpened(pendingItem);
    } else {
      toast("That item isn't here anymore.");
    }
  }, [pendingItem, items, me.userId]);

  // Remember the current filter as this profile's default view.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    const t = setTimeout(() => void saveMyViews({ defaultView: { id: "default", name: "Default", tags: [...selected], who } }).catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, [selected, who]);

  // Unread marker on Activity: looking at the tab marks everything in it seen.
  const unread = unreadActivity(feed, me.userId, me.activitySeenAt);
  useEffect(() => {
    if (tab === "activity" && feed.length) markActivitySeen(Math.max(...feed.map((e) => e.at)));
  }, [tab, feed]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  const groups = useMemo(() => groupTags(tags), [tags]);

  const visible = useMemo(() => {
    const list = Object.values(items).filter((i) => !i.archived && status(i, now) !== "done" && matches(i, selected, tags, who, me.userId));
    list.sort((a, b) => urgency(a, now) - urgency(b, now));
    return {
      overdue: list.filter((i) => status(i, now) === "red"),
      ontrack: list.filter((i) => status(i, now) !== "red"),
    };
  }, [items, selected, tags, who, me.userId, now]);

  // Done Archives a Task; this tab is how you get back to it and its History.
  const finished = useMemo(() => finishedTasks(Object.values(items)), [items]);

  function toggle(id: string) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  }

  /** Done now, or backdated from "Done at…" (m6/03); the server keeps last done if `at` is older. */
  function done(item: Item, at = Date.now()) {
    completeItem(item.id, at);
    setUndo({ itemId: item.id, at, title: item.title });
  }

  const filterCount = selected.size + (who === "anyone" ? 0 : 1);
  const actions = { onOpen: (i: Item) => setEditing(i), onDone: (i: Item) => done(i), onActions: setRowActions };

  return (
    <div className="app" data-density={me.density ?? "cards"}>
      <header>
        <h1>Aubi Honey</h1>
        <span className={`sync ${!online ? "off" : live ? "live" : ""}`} title={!online ? "Offline" : live ? "Live" : "Connecting"}>
          {!online ? `offline${pending ? ` · ${pending} queued` : ""}` : pending ? "saving…" : ""}
        </span>
        <button className="avatar" style={{ background: me.color }} onClick={() => setSettings(true)} aria-label="Settings">
          {(me.displayName ?? me.username)[0].toUpperCase()}
        </button>
      </header>

      <HandoffCard now={now} />

      <nav className="tabs">
        <button className={tab === "ontrack" ? "on" : ""} onClick={() => setTab("ontrack")}>On track <b>{visible.ontrack.length}</b></button>
        <button className={tab === "overdue" ? "on red" : "red"} onClick={() => setTab("overdue")}>Overdue <b>{visible.overdue.length}</b></button>
        <button className={tab === "finished" ? "on" : ""} onClick={() => setTab("finished")}>Finished</button>
        <button className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>
          Activity{unread > 0 && <b className="unread" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</b>}
        </button>
        <button className={tab === "fridge" ? "on" : ""} onClick={() => setTab("fridge")}>Fridge</button>
        <button className={tab === "views" ? "on" : ""} onClick={() => setTab("views")}>Views</button>
        {pinned.map((v) => (
          <button key={v.id} className={tab === `view:${v.id}` ? "on" : ""} onClick={() => setTab(`view:${v.id}`)}>{v.name}</button>
        ))}
      </nav>

      {(tab === "ontrack" || tab === "overdue") && (
        <div className="filters">
          <button className={`chip ${filterCount ? "on" : ""}`} onClick={() => setShowFilters(!showFilters)}>
            Filter{filterCount ? ` · ${filterCount}` : ""} {showFilters ? "▴" : "▾"}
          </button>
          {[...selected].map((id) => tags[id] && (
            <button key={id} className="chip on" onClick={() => toggle(id)}>{chipLabel(tags[id], tags)} ✕</button>
          ))}
          {showFilters && (
            <div className="filter-panel">
              <div className="group">
                <span>Who</span>
                {(["anyone", "mine", "partner", "unassigned"] as Who[]).map((w) => (
                  <button key={w} className={`chip ${who === w ? "on" : ""}`} onClick={() => setWho(w)}>{w}</button>
                ))}
              </div>
              {[...groups].map(([g, ts]) => (
                <div className="group" key={g}>
                  <span>{g}</span>
                  {ts.map((t) => (
                    <button key={t.id} className={`chip ${selected.has(t.id) ? "on" : ""}`} onClick={() => toggle(t.id)}>{t.name}</button>
                  ))}
                </div>
              ))}
              {filterCount > 0 && <button className="link" onClick={() => (setSelected(new Set()), setWho("anyone"))}>Clear filters</button>}
              <button className="link" onClick={saveCurrentAsView}>Save view</button>
            </div>
          )}
        </div>
      )}

      {tab === "ontrack" && <QuickAdd />}

      <main>
        {activeView ? (
          <SavedViewBody view={activeView} items={Object.values(items)} now={now} actions={actions} filter={viewFilter} />
        ) : tab === "views" ? (
          <div className="views">
            <div className="group">
              {BUILTIN_VIEWS.map(([v, label]) => (
                <button key={v} className={`chip ${builtin === v ? "on" : ""}`} onClick={() => setBuiltin(v)}>{label}</button>
              ))}
            </div>
            {builtin === "today" && <TodayView items={Object.values(items)} now={now} actions={actions} />}
            {builtin === "calendar" && <CalendarView items={Object.values(items)} now={now} actions={actions} />}
            {builtin === "board" && <BoardView items={Object.values(items)} now={now} actions={actions} />}
            {builtin === "stats" && <StatsView items={Object.values(items)} now={now} />}
            <h3>Your Saved views</h3>
            <SavedViewsManager views={savedViews} onChange={saveViews} />
          </div>
        ) : tab === "fridge" ? (
          <Fridge now={now} onMakeTask={setFromNote} onOpenTask={openTask} />
        ) : tab === "activity" ? (
          <ul className="feed">
            {feed.length === 0 && <li className="empty">Nothing yet.</li>}
            {feed.map((e) => (
              <li key={e.id}>
                <b>{nameOf(e.by)}</b> {e.type} <i>{e.title}</i>
                {e.detail && <q>{e.detail}</q>}
                <time>{ago(e.at, now)}</time>
              </li>
            ))}
          </ul>
        ) : tab === "finished" ? (
          <ul className="items">
            {finished.length === 0 && <li className="empty">No finished tasks yet.</li>}
            {finished.map((i) => (
              <li key={i.id} className="item done">
                <button className="body" onClick={() => setEditing(i)}>
                  <span className="dot" aria-label={LABEL.done} />
                  <span className="title">{i.title}{i.visibility !== "shared" && <span title="Private"> 🔒</span>}</span>
                  <span className="meta">done {ago(i.lastDoneAt!, now)}{i.lastDoneBy ? ` by ${nameOf(i.lastDoneBy)}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="items">
            {visible[tab === "overdue" ? "overdue" : "ontrack"].length === 0 && (
              <li className="empty">{tab === "overdue" ? "Nothing overdue 🎉" : filterCount ? "No matches for this filter." : "No chores yet. Tap + to add one."}</li>
            )}
            {visible[tab === "overdue" ? "overdue" : "ontrack"].map((i) => (
              <ItemRow key={i.id} item={i} now={now} tags={tags} onOpen={() => setEditing(i)} onDone={() => done(i)} onActions={() => setRowActions(i)} />
            ))}
          </ul>
        )}
      </main>

      <button className="fab" onClick={() => setEditing("new")} aria-label="Add">+</button>

      {undo && (
        <div className="toast">
          Done: {undo.title}
          <button onClick={() => (undoCompletion(undo.itemId, undo.at), setUndo(null))}>Undo</button>
        </div>
      )}
      {toastMsg && !undo && <div className="toast">{toastMsg}</div>}

      {opened && (
        <OpenedItem
          itemId={opened}
          onDone={(i) => (done(i), setOpened(null))}
          onEdit={(i) => (setOpened(null), setEditing(i))}
          onClose={() => setOpened(null)}
        />
      )}
      {rowActions && <RowActions item={rowActions} onDone={(at) => done(rowActions, at)} onClose={() => setRowActions(null)} />}
      {editing && <Editor item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {fromNote && (
        <Editor
          prefill={taskDraft(fromNote)}
          onSaved={(s) => linksNote(s) && markNoteTasked(fromNote.id, s.id)}
          onClose={() => setFromNote(null)}
        />
      )}
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  );
}
