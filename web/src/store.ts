// App state: server snapshot + live updates + a persisted offline outbox.
import { useSyncExternalStore } from "react";
import type { AlertPrefs, Completion, Item, Note } from "@aubi/shared";
import { ApiError, Q, Realtime, gql } from "./api";
import { currentUsername } from "./auth";
import { applyCommentChange, dropItemActivity, type Comment, type CommentChange } from "./comments";
import { applyItemChange, type ItemChange } from "./itemChange";
import { showCachedFirst } from "./launch";
import { keepPending, type ItemInput, type Op } from "./outbox";
import { liveTags } from "./tags";

export interface Tag { id: string; name: string; group: string; color?: string; order?: number; deleted?: boolean; updatedAt: number }
/**
 * Alert prefs as the server holds them. A save sends only the prefs being changed; the server
 * patches them onto the stored ones. Read them with `readAlertPrefs`, which fills defaults and
 * maps a cached pre-M4 `digestAt` to `handoffAt`.
 */
export type AlertPrefsPatch = Partial<AlertPrefs>;
export interface SavedView { id: string; name: string; tags: string[]; who: Who }
export type Who = "anyone" | "mine" | "partner" | "unassigned";
export interface Profile {
  userId: string; username: string; displayName?: string; color?: string; theme?: string; density?: string;
  defaultView?: SavedView | null; savedViews?: SavedView[] | null; alertPrefs?: AlertPrefsPatch | null;
  // Own only (on `me`; the server sends them null elsewhere):
  /** When I last opened Activity (server ms). Read with `unreadActivity`. */
  activitySeenAt?: number | null;
  /** When my last Handoff push was sent, and the start of the "done" window it covered. */
  lastHandoffAt?: number | null;
  lastHandoffSince?: number | null;
  setupComplete: boolean; updatedAt: number;
}
export interface FeedEvent { id: string; at: number; by: string; type: string; itemId?: string; title?: string; detail?: string }

interface State {
  ready: boolean;
  me?: Profile;
  items: Record<string, Item>;
  tags: Record<string, Tag>;
  profiles: Record<string, Profile>;
  feed: FeedEvent[];
  /** Comments of Items opened this session, by Item ID. Not cached: the item screen reloads them. */
  comments: Record<string, Comment[]>;
  /** Fridge Notes by id, expired ones included; show them through the shared fridgeNotes(list, now). */
  fridgeNotes: Record<string, Note>;
  online: boolean;
  live: boolean;
  outbox: Op[];
  toast?: string;
}

const CACHE = "aubi.cache.v1";
const OUTBOX = "aubi.outbox.v1";

let state: State = {
  ready: false,
  items: {}, tags: {}, profiles: {}, feed: [], fridgeNotes: {}, comments: {},
  online: navigator.onLine, live: false,
  outbox: JSON.parse(localStorage.getItem(OUTBOX) ?? "[]"),
  ...JSON.parse(localStorage.getItem(CACHE) ?? "{}"),
};
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if ("outbox" in patch) localStorage.setItem(OUTBOX, JSON.stringify(state.outbox));
  if ("items" in patch || "tags" in patch || "profiles" in patch || "feed" in patch || "fridgeNotes" in patch || "me" in patch) {
    const { me, items, tags, profiles, feed, fridgeNotes } = state;
    localStorage.setItem(CACHE, JSON.stringify({ me, items, tags, profiles, feed, fridgeNotes }));
  }
  listeners.forEach((l) => l());
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => select(state),
  );
}

export const getState = () => state;

export function toast(msg: string) {
  set({ toast: msg });
  setTimeout(() => state.toast === msg && set({ toast: undefined }), 4000);
}

// ---- server -> local ------------------------------------------------------

/** AWSJSON may arrive as an object or (possibly multiply-) encoded string. */
function parseJSON<T>(v: unknown): T | undefined {
  for (let i = 0; typeof v === "string" && i < 3; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  return v === null || v === undefined || typeof v !== "object" ? undefined : (v as T);
}

function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;
}

function itemIn(raw: any): Item {
  return clean({ ...raw, recurrence: parseJSON(raw.recurrence) });
}

function profileIn(raw: any): Profile {
  return clean({
    ...raw,
    defaultView: parseJSON(raw.defaultView),
    savedViews: parseJSON(raw.savedViews),
    alertPrefs: parseJSON(raw.alertPrefs),
  });
}

/** `ownResult`: the change is this device's own mutation result, not a live echo. */
function applyItem(change: ItemChange, ownResult = false) {
  const items = applyItemChange(state.items, { ...change, item: itemIn(change.item) }, state.me?.userId, {
    ownResult,
    refresh: () => void refresh().catch(() => {}),
  });
  if (items !== state.items) set({ items });
  const me = state.me?.userId;
  if (me && change.removedFor?.includes(me)) {
    const { comments, feed } = dropItemActivity(state, change.item.id);
    set({ comments, feed });
  }
}

function applyComment(change: CommentChange) {
  const next = applyCommentChange(state, change, state.items[change.comment.itemId]?.title);
  if (next !== state) set({ comments: next.comments, feed: next.feed });
}

function applyTag(t: Tag) {
  const tags = { ...state.tags };
  if (!t.deleted) {
    tags[t.id] = clean(t);
    set({ tags });
    return;
  }
  delete tags[t.id];
  // deleteTag stripped this Tag from every item server-side and bumped their versions, but it can
  // only publish the Tag (AppSync fans out a mutation's return value, and onItemChange listens to
  // ItemChange mutations only). Strip it locally now, then refresh to pick up the new versions.
  const items = { ...state.items };
  for (const i of Object.values(items)) if (i.tags.includes(t.id)) items[i.id] = { ...i, tags: i.tags.filter((x) => x !== t.id) };
  set({ tags, items });
  void refresh().catch(() => {});
}

/** Fields only `me` carries; the server sends them null on any Profile the partner can also read. */
const OWN_ONLY = ["activitySeenAt", "lastHandoffAt", "lastHandoffSince"] as const;

function applyProfile(raw: any) {
  const p = profileIn(raw);
  const mine = state.me?.userId === p.userId ? { ...p, ...Object.fromEntries(OWN_ONLY.map((k) => [k, state.me![k]])) } : undefined;
  set({ profiles: { ...state.profiles, [p.userId]: p }, ...(mine ? { me: mine } : {}) });
}

/** `serverCopyOf`: take this item from the server even if it has pending ops (conflict replay). */
export async function refresh(serverCopyOf?: string) {
  try {
    const { snapshot } = await gql(Q.snapshot);
    const fromServer: Record<string, Item> = {};
    for (const raw of snapshot.items) fromServer[raw.id] = itemIn(raw);
    // Keep optimistic state (creates, edits, completions) for items with ops still in the outbox.
    const items = keepPending(fromServer, state.items, state.outbox, serverCopyOf);
    const profiles: Record<string, Profile> = {};
    for (const raw of snapshot.profiles) profiles[raw.userId] = profileIn(raw);
    set({
      items,
      tags: Object.fromEntries(snapshot.tags.map((t: Tag) => [t.id, clean(t)])),
      profiles,
      feed: snapshot.feed.map(clean),
      fridgeNotes: Object.fromEntries(snapshot.fridgeNotes.map((n: Note) => [n.id, clean(n)])),
      online: true,
    });
  } catch (e) {
    if (e instanceof ApiError && e.kind === "network") set({ online: false });
    else throw e;
  }
}

let rt: Realtime | undefined;

export async function start() {
  // Weak signal (story 34): with this Member's own cache, show it now and sync behind it.
  const cached = showCachedFirst(state.me, currentUsername());
  if (!cached && state.me) reset(); // someone else's cache: never show it
  if (cached) set({ ready: true });
  const sync = (async () => {
    const { me } = await gql(Q.me).catch((e) => {
      if (state.me) return { me: null }; // offline launch with cache
      throw e;
    });
    if (me) set({ me: profileIn(me) });
    await refresh();
  })();
  if (cached) {
    void sync.then(flush).catch((e) => toast(`Couldn't sync: ${(e as Error).message}`));
  } else {
    await sync;
    set({ ready: true });
    void flush();
  }

  rt = new Realtime(() => void refresh(), (live) => set({ live }));
  rt.subscribe(Q.onItemChange, (c) => c && applyItem(c));
  rt.subscribe(Q.onTagChange, (t) => t && applyTag(t));
  rt.subscribe(Q.onProfileChange, (p) => p && applyProfile(p));
  rt.subscribe(Q.onCommentChange, (c) => c && applyComment(c));
  rt.subscribe(Q.onNoteChange, (n) => n && applyNote(n));
  void rt.connect().catch(() => {});

  const resume = () => {
    if (document.visibilityState !== "visible") return;
    rt?.ensure();
    void refresh().then(flush);
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", () => (set({ online: true }), resume()));
  window.addEventListener("offline", () => set({ online: false }));
}

/** Drop everything held for the last Member, in memory too, so the next sign-in starts clean. */
function reset() {
  state = { ready: false, items: {}, tags: {}, profiles: {}, feed: [], fridgeNotes: {}, comments: {}, online: navigator.onLine, live: false, outbox: [] };
  listeners.forEach((l) => l());
}

export function stop() {
  rt?.close();
  localStorage.removeItem(CACHE);
  localStorage.removeItem(OUTBOX);
  reset();
}

// ---- outbox ----------------------------------------------------------------

let flushing = false;

async function send(op: Exclude<Op, { type: "markNoteTasked" }>) {
  if (op.type === "putItem") {
    // flush runs after a refresh on resume, so state.tags reflects Tags deleted while offline.
    const input = {
      ...op.input,
      tags: liveTags(op.input.tags, state.tags),
      recurrence: op.input.recurrence ? JSON.stringify(op.input.recurrence) : null,
    };
    return (await gql(Q.putItem, { input, expectedVersion: op.expectedVersion })).putItem;
  }
  if (op.type === "completeItem") return (await gql(Q.completeItem, { itemId: op.itemId, at: op.at, note: op.note })).completeItem;
  return (await gql(Q.undoCompletion, { itemId: op.itemId, at: op.at })).undoCompletion;
}

export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (state.outbox.length) {
      const op = state.outbox[0];
      try {
        if (op.type === "markNoteTasked") applyNote((await gql(Q.markNoteTasked, { id: op.noteId, taskId: op.itemId })).markNoteTasked);
        else applyItem(await send(op), true);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        if (e.kind === "network") {
          set({ online: false });
          return;
        }
        if (e.kind === "conflict" && op.type === "putItem") {
          // Field-level last-write-wins: replay only the fields this edit changed on top of the latest server copy.
          await refresh(op.input.id);
          const server = state.items[op.input.id];
          if (server) {
            const merged = { ...toInput(server), ...Object.fromEntries(op.changed.map((k) => [k, op.input[k]])) };
            set({ outbox: [{ ...op, input: merged as ItemInput, expectedVersion: server.version }, ...state.outbox.slice(1)] });
            continue;
          }
        }
        toast(`Couldn't save: ${e.message.replace(/^\w+Error: /, "")}`);
        await refresh();
      }
      set({ outbox: state.outbox.filter((o) => o.id !== op.id), online: true });
    }
  } finally {
    flushing = false;
  }
}

function enqueue(op: Op) {
  set({ outbox: [...state.outbox, op] });
  void flush();
}

export function toInput(i: Item): ItemInput {
  const { id, title, notes, tags, assigneeId, visibility, severity, warnWindow, snoozedUntil, archived } = i;
  const base = { id, title, notes, tags, assigneeId, visibility, severity, warnWindow, snoozedUntil, archived };
  return i.kind === "chore"
    ? { ...base, kind: "chore", recurrence: i.recurrence, dueAt: undefined }
    : { ...base, kind: "task", recurrence: undefined, dueAt: i.dueAt };
}

// ---- actions (optimistic) ---------------------------------------------------

export function saveItem(input: ItemInput) {
  const cur = state.items[input.id];
  const me = state.me!.userId;
  const now = Date.now();
  const before = cur ? toInput(cur) : undefined;
  const changed = (Object.keys(input) as (keyof ItemInput)[]).filter(
    (k) => JSON.stringify(input[k]) !== JSON.stringify(before?.[k]),
  );
  if (cur && changed.length === 0) return;
  set({
    items: {
      ...state.items,
      [input.id]: { ...(cur ?? { createdBy: me, createdAt: now, version: 0 }), ...input, updatedAt: now } as Item,
    },
  });
  enqueue({ id: crypto.randomUUID(), type: "putItem", input, expectedVersion: cur?.version, changed });
}

export function completeItem(itemId: string, at = Date.now(), note?: string) {
  const cur = state.items[itemId];
  if (cur && (cur.lastDoneAt ?? 0) < at) {
    // Done finishes and Archives a Task (the server does the same); a Chore is only Reset.
    const archived = cur.kind === "task" ? true : cur.archived;
    set({ items: { ...state.items, [itemId]: { ...cur, lastDoneAt: at, lastDoneBy: state.me!.userId, snoozedUntil: undefined, archived } } });
  }
  enqueue({ id: crypto.randomUUID(), type: "completeItem", itemId, at, note });
}

export function undoCompletion(itemId: string, at: number) {
  enqueue({ id: crypto.randomUUID(), type: "undoCompletion", itemId, at });
}

export function snooze(itemId: string, until: number | undefined) {
  const cur = state.items[itemId];
  if (cur) saveItem({ ...toInput(cur), snoozedUntil: until });
}

export async function saveTag(t: Omit<Tag, "updatedAt">) {
  applyTag((await gql(Q.putTag, { input: { id: t.id, name: t.name, group: t.group, color: t.color, order: t.order } })).putTag);
}

export async function removeTag(id: string) {
  applyTag((await gql(Q.deleteTag, { id })).deleteTag);
}

export async function saveProfile(patch: Partial<Profile>) {
  const input: Record<string, unknown> = { ...patch };
  for (const k of ["defaultView", "savedViews", "alertPrefs"]) if (k in input) input[k] = JSON.stringify(input[k]);
  applyProfile((await gql(Q.putProfile, { input })).putProfile);
}

/**
 * Opening Activity: clear the unread marker here at once, then save last seen so my other devices
 * clear too when they next load `me`. Its own mutation, which nothing fans out, so the partner
 * never learns when I read Activity. `at` is the newest entry's server time, so device clocks don't
 * matter. If the save fails (offline) the next open saves it again.
 */
export function markActivitySeen(at: number) {
  const me = state.me;
  if (!me || (me.activitySeenAt ?? 0) >= at) return;
  set({ me: { ...me, activitySeenAt: at } });
  void gql(Q.markActivitySeen, { at }).catch(() => {});
}

export async function loadCompletions(itemId: string) {
  return (await gql(Q.completions, { itemId, limit: 50 })).completions as { itemId: string; at: number; by: string; note?: string }[];
}

/**
 * The newest Completions of several items in one request: aliased copies of the visibility-checked
 * `completions` read (the Handoff card's "done", m2/04). `limit` per item.
 */
export async function loadCompletionsOf(itemIds: string[], limit = 20): Promise<Completion[]> {
  if (!itemIds.length) return [];
  const vars = itemIds.map((_, n) => `$i${n}: ID!`).join(", ");
  const reads = itemIds.map((_, n) => `c${n}: completions(itemId: $i${n}, limit: ${limit}) { itemId at by }`).join(" ");
  const data = await gql<Record<string, Completion[]>>(`query(${vars}) { ${reads} }`, Object.fromEntries(itemIds.map((id, n) => [`i${n}`, id])));
  return Object.values(data).flat();
}

// ---- Comments (M2) ----------------------------------------------------------

export async function loadComments(itemId: string) {
  const list = (await gql(Q.comments, { itemId })).comments as Comment[];
  set({ comments: { ...state.comments, [itemId]: list } });
}

/**
 * Online only (no outbox): the caller shows the error and keeps the draft. Retrying with the same
 * `id` (a new one per draft) can't post the Comment twice.
 */
export async function addComment(itemId: string, id: string, text: string) {
  applyComment((await gql(Q.addComment, { itemId, id, text })).addComment);
}

export function nameOf(userId?: string) {
  if (!userId) return "";
  const p = state.profiles[userId];
  return p?.displayName || p?.username || "someone";
}

// ---- Fridge Notes (m2/02) ---------------------------------------------------
// Notes go straight to the server (no outbox): a post shows at once and is taken back if the
// server refuses it. The client picks the ID, so a retried post never makes a second Note.

/** Take a Note from the server or a live echo; an older copy never replaces a newer one. */
function applyNote(raw: Note) {
  const n = clean(raw);
  const cur = state.fridgeNotes[n.id];
  if (cur && cur.updatedAt > n.updatedAt) return;
  set({ fridgeNotes: { ...state.fridgeNotes, [n.id]: n } });
}

type NoteMutation = "postNote" | "pinNote" | "setNoteExpiry";

/** Run one Note mutation and take its result, read by the mutation's field name. */
async function sendNote(field: NoteMutation, vars: object, undo: () => void) {
  try {
    applyNote((await gql<Record<NoteMutation, Note>>(Q[field], vars))[field]);
  } catch (e) {
    undo();
    toast(`Couldn't save the Note: ${(e as Error).message.replace(/^\w+Error: /, "")}`);
  }
}

export function postNote(text: string, opts: { pinned?: boolean; expiresAt?: number } = {}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const note: Note = {
    id, text: text.trim(), by: state.me!.userId, at: now, pinned: !!opts.pinned, expiresAt: opts.expiresAt,
    visibility: "shared", updatedAt: now,
  };
  set({ fridgeNotes: { ...state.fridgeNotes, [id]: note } });
  return sendNote("postNote", { id, text, pinned: !!opts.pinned, expiresAt: opts.expiresAt ?? null }, () => {
    const { [id]: _gone, ...rest } = state.fridgeNotes;
    set({ fridgeNotes: rest });
  });
}

function editNote(id: string, patch: Partial<Note>, field: NoteMutation, vars: object) {
  const cur = state.fridgeNotes[id];
  if (!cur) return;
  set({ fridgeNotes: { ...state.fridgeNotes, [id]: { ...cur, ...patch } } });
  return sendNote(field, vars, () => set({ fridgeNotes: { ...state.fridgeNotes, [id]: cur } }));
}

export function pinNote(id: string, pinned: boolean) {
  return editNote(id, { pinned }, "pinNote", { id, pinned });
}

/** `expiresAt` undefined clears the expiry. */
export function setNoteExpiry(id: string, expiresAt: number | undefined) {
  return editNote(id, { expiresAt }, "setNoteExpiry", { id, expiresAt: expiresAt ?? null });
}

// ---- Note to Task (m2/03) ---------------------------------------------------

/**
 * Mark a Note as turned into the Task just saved. It goes through the outbox behind that Task's
 * putItem, so it works offline and the server always has the Task first.
 */
export function markNoteTasked(noteId: string, taskId: string) {
  const cur = state.fridgeNotes[noteId];
  if (!cur || cur.taskId) return;
  set({ fridgeNotes: { ...state.fridgeNotes, [noteId]: { ...cur, taskId } } });
  enqueue({ id: crypto.randomUUID(), type: "markNoteTasked", noteId, itemId: taskId });
}
