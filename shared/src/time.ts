// Pacific-time helpers. The app is pinned to one zone (SPEC §11), so we only need
// "wall clock in LA" <-> epoch conversions, done with Intl so DST is handled.

export const TZ = "America/Los_Angeles";
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** How far ahead of the server a device clock may be when it says "done now". */
export const CLOCK_SLACK_MS = 60_000;

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  weekday: "short",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface Wall {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun
}

export function toWall(ms: number): Wall {
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(new Date(ms))) p[type] = value;
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

/** Epoch ms for a wall-clock time in Pacific. Day overflow (e.g. day 32) rolls over. */
export function fromWall(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive;
  // Two passes converge across DST boundaries.
  for (let i = 0; i < 2; i++) {
    const w = toWall(guess);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
    guess += naive - asUtc;
  }
  return guess;
}

export function parseHHMM(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(":").map(Number);
  return { hour: h, minute: m ?? 0 };
}
