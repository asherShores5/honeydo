// Quick-add (SPEC story 47): one line of shorthand, e.g. `bath every 3d #baby @aubyn`, becomes an
// item input. Pure, so the Home box and its tests agree. Unknown Tags or names are reported, never
// guessed or dropped.
import type { Recurrence, UserId } from "./types";
import type { ViewTag } from "./views";

export interface QuickAddContext {
  me: UserId;
  /** Each Member with the names they can be @-mentioned by (display name, username). */
  members: { userId: UserId; names: string[] }[];
  tags: ViewTag[];
}

export type QuickAddItem =
  | { kind: "chore"; title: string; recurrence: Recurrence; tags: string[]; assigneeId?: UserId }
  | { kind: "task"; title: string; tags: string[]; assigneeId?: UserId };

export type QuickAddResult = { ok: true; item: QuickAddItem } | { ok: false; errors: string[] };

const UNITS: Record<string, "hours" | "days" | "weeks"> = {
  h: "hours", hr: "hours", hrs: "hours", hour: "hours", hours: "hours",
  d: "days", day: "days", days: "days",
  w: "weeks", wk: "weeks", wks: "weeks", week: "weeks", weeks: "weeks",
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const key = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, "-");

/** "tue", "tues", "tuesday" → 2: three or more letters from the start of a day's name. */
function weekday(word: string): number | undefined {
  const w = word.toLowerCase();
  const i = w.length >= 3 ? WEEKDAYS.findIndex((d) => d.startsWith(w)) : -1;
  return i === -1 ? undefined : i;
}

/** "8pm", "8:30pm", "20:00", "7:30" → "HH:MM"; undefined if it isn't a time. */
function clock(word: string): string | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(word);
  if (!m) return undefined;
  let h = +m[1];
  const min = m[2] === undefined ? 0 : +m[2];
  const ampm = m[3]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return undefined;
    h = (h % 12) + (ampm === "pm" ? 12 : 0);
  } else if (m[2] === undefined) {
    return undefined; // a bare "8" is too vague
  }
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** A Tag by ID, by name, or by a unique start of its name. */
function findTag(word: string, tags: ViewTag[]): { tag?: ViewTag; error?: string } {
  const k = key(word);
  const byId = tags.find((t) => t.id === k);
  if (byId) return { tag: byId };
  const named = tags.filter((t) => key(t.name) === k);
  const candidates = named.length ? named : tags.filter((t) => key(t.name).startsWith(k));
  if (candidates.length === 1) return { tag: candidates[0] };
  if (candidates.length > 1) {
    const groups = candidates.map((t) => t.group).join(", ");
    return { error: `#${word} matches Tags in ${groups}; use one of ${candidates.map((t) => `#${t.id}`).join(", ")}` };
  }
  return { error: `no Tag called #${word}` };
}

export function parseQuickAdd(line: string, ctx: QuickAddContext): QuickAddResult {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const errors: string[] = [];
  const title: string[] = [];
  const tags: string[] = [];
  let assigneeId: UserId | undefined;
  let interval: { every: number; unit: "hours" | "days" | "weeks" } | undefined;
  let byWeekday: number[] | undefined;
  let at: string | undefined;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lower = w.toLowerCase();
    if (w.startsWith("#") && w.length > 1) {
      const { tag, error } = findTag(w.slice(1), ctx.tags);
      if (tag) tags.includes(tag.id) || tags.push(tag.id);
      else errors.push(error!);
    } else if (w.startsWith("@") && w.length > 1) {
      const name = w.slice(1).toLowerCase();
      const m = name === "me" ? ctx.me : ctx.members.find((x) => x.names.some((n) => n.toLowerCase() === name))?.userId;
      if (m) assigneeId = m;
      else errors.push(`no one called @${w.slice(1)}`);
    } else if (lower === "daily") {
      interval = { every: 1, unit: "days" };
    } else if (lower === "weekly") {
      interval = { every: 1, unit: "weeks" };
    } else if (lower === "every" && i + 1 < words.length) {
      const next = words[i + 1].toLowerCase();
      const compact = /^(\d+)([a-z]+)$/.exec(next);
      const days = next.split(",").map(weekday);
      if (compact && UNITS[compact[2]]) {
        interval = { every: +compact[1], unit: UNITS[compact[2]] };
        i += 1;
      } else if (/^\d+$/.test(next) && UNITS[words[i + 2]?.toLowerCase()]) {
        interval = { every: +next, unit: UNITS[words[i + 2].toLowerCase()] };
        i += 2;
      } else if (UNITS[next]) {
        interval = { every: 1, unit: UNITS[next] };
        i += 1;
      } else if (days.every((d) => d !== undefined)) {
        byWeekday = [...new Set(days as number[])].sort((a, b) => a - b);
        i += 1;
      } else {
        title.push(w);
      }
    } else if (lower === "at" && i + 1 < words.length && (byWeekday || /\d/.test(words[i + 1]))) {
      const t = clock(words[i + 1]);
      if (t) at = t;
      else errors.push(`"${words[i + 1]}" isn't a time (try 8pm or 20:00)`);
      i += 1;
    } else {
      title.push(w);
    }
  }

  if (interval && interval.every < 1) errors.push("repeat every 1 or more");
  if (at && !byWeekday) errors.push("a time only goes with weekdays, e.g. every tue at 8pm");
  const text = title.join(" ").trim();
  if (!text) errors.push("add a title before the shorthand");
  if (errors.length) return { ok: false, errors };

  const who = assigneeId ? { assigneeId } : {};
  if (byWeekday) {
    const recurrence: Recurrence = { type: "calendar", freq: "weekly", byWeekday, ...(at ? { at } : {}) };
    return { ok: true, item: { kind: "chore", title: text, recurrence, tags, ...who } };
  }
  if (interval) return { ok: true, item: { kind: "chore", title: text, recurrence: { type: "interval", ...interval }, tags, ...who } };
  return { ok: true, item: { kind: "task", title: text, tags, ...who } };
}
