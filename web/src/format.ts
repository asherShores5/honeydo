import { DAY, HOUR, TZ, fromWall } from "@aubi/shared";

export function span(ms: number): string {
  const a = Math.abs(ms);
  if (a < HOUR) return `${Math.max(1, Math.round(a / 60_000))}m`;
  if (a < DAY) return `${Math.round(a / HOUR)}h`;
  if (a < 14 * DAY) {
    const d = Math.floor(a / DAY);
    const h = Math.round((a - d * DAY) / HOUR);
    return h && d < 3 ? `${d}d ${h}h` : `${d}d`;
  }
  return `${Math.round(a / (7 * DAY))}w`;
}

/** A row's due text. Within a minute either way reads "due now", so a just-created Chore (due at creation) doesn't say "due in 1m". */
export function dueLabel(nextDue: number | null, now: number): string {
  if (nextDue === null) return "no due date";
  if (Math.abs(nextDue - now) < 60_000) return "due now";
  return nextDue > now ? `due in ${span(nextDue - now)}` : `overdue ${span(now - nextDue)}`;
}

export const ago = (t: number, now = Date.now()) => `${span(now - t)} ago`;

const dt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const when = (t: number) => dt.format(new Date(t));

/** "YYYY-MM-DDTHH:MM" in Pacific for <input type=datetime-local>. */
export function toLocalInput(t: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Epoch ms from a <input type=datetime-local> value read as Pacific; undefined if empty or malformed. */
export function fromLocalInput(v: string): number | undefined {
  const m = v.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+)$/);
  return m ? fromWall(+m[1], +m[2], +m[3], +m[4], +m[5]) : undefined;
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tag";
}

export function newId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}
