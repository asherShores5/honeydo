import type { Item, Recurrence, Status } from "./types";
import { DAY, HOUR, fromWall, parseHHMM, toWall } from "./time";

const UNIT_MS = { hours: HOUR, days: DAY, weeks: 7 * DAY } as const;

/** SPEC §4.2: max(1 day, 10% of interval), capped at 50% of interval for short chores. */
export function defaultWarnWindow(intervalMs: number): number {
  return Math.min(Math.max(DAY, intervalMs * 0.1), intervalMs * 0.5);
}

// ---- calendar schedules ----------------------------------------------------

type CalendarRec = Extract<Recurrence, { type: "calendar" }>;

/** Occurrence on a given Pacific calendar day, or null if the schedule skips it. */
function occurrenceOn(rec: CalendarRec, year: number, month: number, day: number): number | null {
  const { hour, minute } = parseHHMM(rec.at ?? "20:00");
  // Normalize overflowed days (e.g. Oct 32 → Nov 1) before matching.
  const d = toWall(fromWall(year, month, day, 12));
  const ms = fromWall(d.year, d.month, d.day, hour, minute);
  if (rec.freq === "weekly") return rec.byWeekday.includes(d.weekday) ? ms : null;
  // A month's 31st (etc.) falls back to its last day so it still recurs monthly.
  const lastDay = toWall(fromWall(d.year, d.month + 1, 0, 12)).day;
  return rec.byMonthDay.some((x) => Math.min(x, lastDay) === d.day) ? ms : null;
}

/** First occurrence strictly after `t`. */
export function nextOccurrence(rec: CalendarRec, t: number): number {
  const w = toWall(t);
  for (let i = 0; i <= 62; i++) {
    const occ = occurrenceOn(rec, w.year, w.month, w.day + i);
    if (occ !== null && occ > t) return occ;
  }
  throw new Error("calendar recurrence has no occurrences");
}

/** Last occurrence at or before `t`. */
export function prevOccurrence(rec: CalendarRec, t: number): number {
  const w = toWall(t);
  for (let i = 0; i <= 62; i++) {
    const occ = occurrenceOn(rec, w.year, w.month, w.day - i);
    if (occ !== null && occ <= t) return occ;
  }
  throw new Error("calendar recurrence has no occurrences");
}

// ---- due + status ----------------------------------------------------------

export interface Schedule {
  /** null = no due date (undated task). */
  nextDue: number | null;
  warnWindow: number;
}

export function schedule(item: Item): Schedule {
  if (item.kind === "task") {
    return { nextDue: item.dueAt ?? null, warnWindow: item.warnWindow ?? DAY };
  }
  const rec = item.recurrence;

  if (rec.type === "interval") {
    const interval = rec.every * UNIT_MS[rec.unit];
    const warnWindow = item.warnWindow ?? defaultWarnWindow(interval);
    // Never done: due now, so it shows up as something to do.
    const nextDue = item.lastDoneAt === undefined ? item.createdAt : item.lastDoneAt + interval;
    return { nextDue, warnWindow };
  }

  const base = item.lastDoneAt ?? item.createdAt;
  let next = nextOccurrence(rec, base);
  const gap = next - prevOccurrence(rec, base);
  const warnWindow = item.warnWindow ?? defaultWarnWindow(gap);
  // Done early (inside the upcoming occurrence's yellow window) counts for that occurrence:
  // taking the trash out Tue 7pm satisfies Tue 8pm, so the next due is the following Tue.
  if (item.lastDoneAt !== undefined && next - item.lastDoneAt <= warnWindow) {
    next = nextOccurrence(rec, next);
  }
  return { nextDue: next, warnWindow };
}

export function status(item: Item, now: number): Status {
  if (item.kind === "task" && item.lastDoneAt !== undefined) return "done";
  if (item.snoozedUntil !== undefined && item.snoozedUntil > now) return "snoozed";
  const { nextDue, warnWindow } = schedule(item);
  if (nextDue === null) return "green";
  if (now >= nextDue) return "red";
  if (now >= nextDue - warnWindow) return "yellow";
  return "green";
}

/** Sort key for "most urgent first": red by how overdue, then soonest due. */
export function urgency(item: Item, now: number): number {
  const { nextDue } = schedule(item);
  return nextDue === null ? Number.POSITIVE_INFINITY : nextDue - now;
}
