// App state: server snapshot + live updates + a persisted offline outbox.
import { useSyncExternalStore } from "react";
import type { AlertPrefs, Item } from "@aubi/shared";
import { ApiError, Q, Realtime, gql } from "./api";
import { applyItemChange, type ItemChange } from "./itemChange";
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
  online: boolean;
  live: boolean;
  outbox: Op[];
  toast?: string;
}

const CACHE = "aubi.cache.v1";
const OUTBOX = "aubi.outbox.v1";

let state: State = {
  ready: false,
  items: {}, tags: {}, profiles: {}, feed: [],
  online: navigator.onLine, live: false,
  outbox: JSON.parse(localStorage.getItem(OUTBOX) ?? "[]"),
  ...JSON.parse(localStorage.getItem(CACHE) ?? "{}"),
};
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if ("outbox" in patch) localStorage.setItem(OUTBOX, JSON.stringify(state.outbox));
  if ("items" in patch || "tags" in patch || "profiles" in patch || "feed" in patch || "me" in patch) {
    const { me, items, tags, profiles, feed } = state;
    localStorage.setItem(CACHE, JSON.stringify({ me, items, tags, profiles, feed }));
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

function applyProfile(raw: any) {
  const p = profileIn(raw);
  set({ profiles: { ...state.profiles, [p.userId]: p }, ...(state.me?.userId === p.userId ? { me: p } : {}) });
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
      online: true,
    });
  } catch (e) {
    if (e instanceof ApiError && e.kind === "network") set({ online: false });
    else throw e;
  }
}

let rt: Realtime | undefined;

export async function start() {
  const { me } = await gql(Q.me).catch((e) => {
    if (state.me) return { me: null }; // offline launch with cache
    throw e;
  });
  if (me) set({ me: profileIn(me) });
  await refresh();
  set({ ready: true });
  void flush();

  rt = new Realtime(() => void refresh(), (live) => set({ live }));
  rt.subscribe(Q.onItemChange, (c) => c && applyItem(c));
  rt.subscribe(Q.onTagChange, (t) => t && applyTag(t));
  rt.subscribe(Q.onProfileChange, (p) => p && applyProfile(p));
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

export function stop() {
  rt?.close();
  localStorage.removeItem(CACHE);
  localStorage.removeItem(OUTBOX);
}

// ---- outbox ----------------------------------------------------------------

let flushing = false;

async function send(op: Op) {
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
        const change = await send(op);
        applyItem(change, true);
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

export async function loadCompletions(itemId: string) {
  return (await gql(Q.completions, { itemId, limit: 50 })).completions as { itemId: string; at: number; by: string; note?: string }[];
}

export function nameOf(userId?: string) {
  if (!userId) return "";
  const p = state.profiles[userId];
  return p?.displayName || p?.username || "someone";
}
