import { useEffect, useMemo, useRef, useState } from "react";
import { schedule, status, urgency, type Item, type Status } from "@aubi/shared";
import { completeItem, nameOf, saveProfile, undoCompletion, useStore, type Tag, type Who } from "../store";
import { ago, span } from "../format";
import { Editor } from "./Editor";
import { Settings } from "./Settings";
import { finishedTasks } from "../finished";

type Tab = "ontrack" | "overdue" | "finished" | "activity";

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

export function groupTags(tags: Record<string, Tag>) {
  const groups = new Map<string, Tag[]>();
  for (const t of Object.values(tags).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name))) {
    groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
  }
  return groups;
}

/** OR within a tag group, AND across groups (SPEC §4.3). */
function matches(item: Item, selected: Set<string>, tags: Record<string, Tag>, who: Who, me: string) {
  const byGroup = new Map<string, string[]>();
  for (const id of selected) {
    const g = tags[id]?.group;
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), id]);
  }
  for (const ids of byGroup.values()) if (!ids.some((id) => item.tags.includes(id))) return false;
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

  // Remember the current filter as this profile's default view.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    const t = setTimeout(() => void saveProfile({ defaultView: { id: "default", name: "Default", tags: [...selected], who } }).catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, [selected, who]);

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

  function done(item: Item) {
    const at = Date.now();
    completeItem(item.id, at);
    setUndo({ itemId: item.id, at, title: item.title });
  }

  const filterCount = selected.size + (who === "anyone" ? 0 : 1);

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

      <nav className="tabs">
        <button className={tab === "ontrack" ? "on" : ""} onClick={() => setTab("ontrack")}>On track <b>{visible.ontrack.length}</b></button>
        <button className={tab === "overdue" ? "on red" : "red"} onClick={() => setTab("overdue")}>Overdue <b>{visible.overdue.length}</b></button>
        <button className={tab === "finished" ? "on" : ""} onClick={() => setTab("finished")}>Finished</button>
        <button className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>Activity</button>
      </nav>

      {(tab === "ontrack" || tab === "overdue") && (
        <div className="filters">
          <button className={`chip ${filterCount ? "on" : ""}`} onClick={() => setShowFilters(!showFilters)}>
            Filter{filterCount ? ` · ${filterCount}` : ""} {showFilters ? "▴" : "▾"}
          </button>
          {[...selected].map((id) => tags[id] && (
            <button key={id} className="chip on" onClick={() => toggle(id)}>{tags[id].name} ✕</button>
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
            </div>
          )}
        </div>
      )}

      <main>
        {tab === "activity" ? (
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
            {visible[tab].length === 0 && (
              <li className="empty">{tab === "overdue" ? "Nothing overdue 🎉" : filterCount ? "No matches for this filter." : "No chores yet. Tap + to add one."}</li>
            )}
            {visible[tab].map((i) => (
              <ItemRow key={i.id} item={i} now={now} tags={tags} onOpen={() => setEditing(i)} onDone={() => done(i)} />
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

      {editing && <Editor item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  );
}

const LABEL: Record<Status, string> = { green: "On track", yellow: "Due soon", red: "Overdue", snoozed: "Snoozed", done: "Done" };

function ItemRow({ item, now, tags, onOpen, onDone }: { item: Item; now: number; tags: Record<string, Tag>; onOpen: () => void; onDone: () => void }) {
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
          <span className="tags">{item.tags.map((t) => tags[t] && <span key={t}>{tags[t].name}</span>)}</span>
        )}
      </button>
      <button className="done" onClick={onDone} aria-label={`Mark ${item.title} done`}>✓</button>
    </li>
  );
}
