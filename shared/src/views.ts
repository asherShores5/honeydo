// M5 Views (SPEC stories 42-46): pure derivations over the snapshot plus Completions.
// No server state: the client renders these, so tests pin the behaviour here (Seam 1).
import type { Completion, Item, UserId } from "./types";
import { intervalMs, nextOccurrence, schedule, status, urgency } from "./status";
import { fromWall, toWall } from "./time";

/** The Tag fields a view needs (the client's Tag index carries more). */
export interface ViewTag {
  id: string;
  name: string;
  group: string;
  order?: number;
}

/** One group or column of a view: a Tag, or null for items without one in that Tag group. */
export interface TagColumn {
  tag: ViewTag | null;
  items: Item[];
}

export const TIME_OF_DAY = "Time of day";

// ---- Saved views (story 46) ---------------------------------------------------

export const WHO = ["anyone", "mine", "partner", "unassigned"] as const;
export type Who = (typeof WHO)[number];
export const VIEW_SORTS = ["urgency", "priority", "title", "lastDone"] as const;
export type ViewSort = (typeof VIEW_SORTS)[number];
export const VIEW_LAYOUTS = ["list", "today", "board", "calendar"] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];
export const SAVED_VIEWS_MAX = 20;
export const VIEW_NAME_MAX = 40;
export const VIEW_TAGS_MAX = 50;

/** A Member's named filter, sort and layout; `pinned` ones show as tabs. Lives on their Profile. */
export interface SavedView {
  id: string;
  name: string;
  /** Tag filter: OR within a Tag group, AND across groups. */
  tags: string[];
  who: Who;
  sort?: ViewSort;
  layout?: ViewLayout;
  /** The Tag group a "board" layout shows. */
  boardGroup?: string;
  pinned?: boolean;
}

const byOrder = (a: ViewTag, b: ViewTag) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name);

/** Still on the lists: not Archived, and not a finished Task. */
export function isActive(item: Item, now: number): boolean {
  return !item.archived && status(item, now) !== "done";
}

/** Tags of one Tag group in display order. */
export function tagsInGroup(tags: ViewTag[], group: string): ViewTag[] {
  return tags.filter((t) => t.group === group).sort(byOrder);
}

/** End of the Pacific day containing `t` (the next midnight). */
export function endOfDay(t: number): number {
  const w = toWall(t);
  return fromWall(w.year, w.month, w.day + 1);
}

/**
 * Today (story 42): active items that are red, yellow, or due before tonight's midnight, grouped
 * by Time-of-day Tag in that group's order, untagged last. An item with several Time-of-day Tags
 * sits under the first. Empty groups are left out; each group is most urgent first.
 */
export function todayGroups(items: Item[], tags: ViewTag[], now: number): TagColumn[] {
  const order = tagsInGroup(tags, TIME_OF_DAY);
  const tonight = endOfDay(now);
  const today = items.filter((i) => {
    if (i.archived) return false;
    const st = status(i, now);
    if (st === "red" || st === "yellow") return true;
    if (st !== "green") return false;
    const { nextDue } = schedule(i);
    return nextDue !== null && nextDue < tonight;
  });
  const due = (i: Item) => schedule(i).nextDue ?? Number.POSITIVE_INFINITY;
  const columns: TagColumn[] = [...order.map((tag) => ({ tag, items: [] as Item[] })), { tag: null, items: [] }];
  for (const item of today) {
    const at = order.findIndex((t) => item.tags.includes(t.id));
    columns[at === -1 ? order.length : at].items.push(item);
  }
  for (const c of columns) c.items.sort((a, b) => due(a) - due(b));
  return columns.filter((c) => c.items.length > 0);
}

// ---- Calendar (story 43) ----------------------------------------------------

export interface CalendarEntry {
  kind: "due" | "done";
  itemId: string;
  title: string;
  at: number;
  /** Who did it (done entries only). */
  by?: UserId;
}

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
  /** Pacific midnight that starts the day. */
  start: number;
  /** Oldest first. */
  entries: CalendarEntry[];
}

/**
 * Due points of an Item up to `end` (exclusive): its current Next due, then the ones after it. An
 * overdue Chore's later due points count from `now`, since a missed one doesn't move the next ones
 * earlier (and a long-overdue hourly Chore doesn't step through months).
 */
export function dueDates(item: Item, end: number, now: number): number[] {
  if (!isActive(item, now)) return [];
  const first = schedule(item).nextDue;
  if (first === null) return [];
  if (item.kind === "task") return first < end ? [first] : [];
  const rec = item.recurrence;
  const after = rec.type === "interval" ? (t: number) => t + intervalMs(rec) : (t: number) => nextOccurrence(rec, t);
  const out: number[] = [];
  for (let t = first; t < end; t = after(Math.max(t, now))) out.push(t);
  return out;
}

/**
 * `days` Pacific days from the one containing `start`: upcoming due dates (Chores projected
 * forward from their Next due) and past Completions. Completions of items not in `items` (not
 * visible, or deleted) are left out.
 */
export function calendarDays(items: Item[], completions: Completion[], start: number, days: number, now: number): CalendarDay[] {
  const s = toWall(start);
  const out: CalendarDay[] = [];
  for (let n = 0; n < days; n++) {
    const dayStart = fromWall(s.year, s.month, s.day + n);
    const w = toWall(dayStart);
    out.push({ year: w.year, month: w.month, day: w.day, start: dayStart, entries: [] });
  }
  const end = fromWall(s.year, s.month, s.day + days);
  const dayOf = (t: number) => {
    for (let n = out.length - 1; n >= 0; n--) if (t >= out[n].start) return t < end ? out[n] : undefined;
    return undefined;
  };
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const item of items) {
    for (const at of dueDates(item, end, now)) dayOf(at)?.entries.push({ kind: "due", itemId: item.id, title: item.title, at });
  }
  for (const c of completions) {
    const item = byId.get(c.itemId);
    if (item) dayOf(c.at)?.entries.push({ kind: "done", itemId: c.itemId, title: item.title, at: c.at, by: c.by });
  }
  for (const d of out) d.entries.sort((a, b) => a.at - b.at);
  return out;
}

// ---- Tag board (story 44) ---------------------------------------------------

/**
 * One column per Tag in `group` (empty ones too, so the board's shape is stable), then a column
 * for active items with no Tag in that group. An item with several of the group's Tags shows in
 * each of their columns. Archived and finished items are left out; each column is most urgent first.
 */
export function tagBoard(items: Item[], tags: ViewTag[], group: string, now: number): TagColumn[] {
  const order = tagsInGroup(tags, group);
  const active = items
    .filter((i) => isActive(i, now))
    .sort((a, b) => urgency(a, now) - urgency(b, now));
  const inGroup = new Set(order.map((t) => t.id));
  return [
    ...order.map((tag) => ({ tag, items: active.filter((i) => i.tags.includes(tag.id)) })),
    { tag: null, items: active.filter((i) => !i.tags.some((t) => inGroup.has(t))) },
  ];
}

// ---- History & stats (story 45) ---------------------------------------------

export interface MemberCount {
  userId: UserId;
  count: number;
}

export interface ChoreRhythm {
  itemId: string;
  title: string;
  /** The Interval. */
  targetMs: number;
  /** Mean gap between this period's Completions; null with fewer than two. */
  actualMs: number | null;
  count: number;
}

export interface HistoryStats {
  /** Every Member, most Completions first. */
  byMember: MemberCount[];
  /** Active Interval Chores, in `items` order. */
  chores: ChoreRhythm[];
}

/**
 * Who did what in [from, to) and how each Interval Chore's real rhythm compares with its target.
 * Only Completions of items in `items` count (Finished Tasks included), so the partner's
 * Private items never show.
 */
export function historyStats(items: Item[], completions: Completion[], members: UserId[], from: number, to: number): HistoryStats {
  const byId = new Map(items.map((i) => [i.id, i]));
  const inPeriod = completions.filter((c) => c.at >= from && c.at < to && byId.has(c.itemId));
  const counts = new Map(members.map((m) => [m, 0]));
  for (const c of inPeriod) counts.set(c.by, (counts.get(c.by) ?? 0) + 1);
  const byMember = [...counts].map(([userId, count]) => ({ userId, count })).sort((a, b) => b.count - a.count);

  const chores: ChoreRhythm[] = [];
  for (const item of items) {
    if (item.archived || item.kind !== "chore" || item.recurrence.type !== "interval") continue;
    const times = inPeriod.filter((c) => c.itemId === item.id).map((c) => c.at).sort((a, b) => a - b);
    const actualMs = times.length < 2 ? null : (times[times.length - 1] - times[0]) / (times.length - 1);
    chores.push({ itemId: item.id, title: item.title, targetMs: intervalMs(item.recurrence), actualMs, count: times.length });
  }
  return { byMember, chores };
}

const PRIORITY: Record<string, number> = { high: 0, medium: 1, low: 2 };
const priority = (i: Item) => PRIORITY[i.severity ?? "low"];

/**
 * A list's order: soonest due first ("urgency": overdue, then due soonest, undated last), by
 * Severity (high, medium, then low or unset; ties soonest due), by title, or longest since last
 * Done (never done first).
 */
export function sortItems(items: Item[], sort: ViewSort, now: number): Item[] {
  const byDue = (a: Item, b: Item) => urgency(a, now) - urgency(b, now);
  const key: Record<ViewSort, (a: Item, b: Item) => number> = {
    urgency: byDue,
    priority: (a, b) => priority(a) - priority(b) || byDue(a, b),
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    lastDone: (a, b) => (a.lastDoneAt ?? Number.NEGATIVE_INFINITY) - (b.lastDoneAt ?? Number.NEGATIVE_INFINITY),
  };
  return [...items].sort(key[sort]);
}
