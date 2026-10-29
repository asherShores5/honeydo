import type { AlertPrefs, Item, Severity, UserId } from "./types";
import { DAY, fromWall, parseHHMM, toWall } from "./time";
import { schedule, status } from "./status";

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  // One Slot a day for low Severity, two for medium, three for high (SPEC §4.6).
  slots: { low: ["09:00"], medium: ["09:00", "17:00"], high: ["09:00", "13:00", "19:00"] },
  quietStart: "21:00",
  quietEnd: "07:00",
  handoffAt: "20:00",
  overdueAlerts: true,
};

/** Dings per day for each Severity, taken from the default Slots so the two can't disagree. */
export const SLOTS_PER_SEVERITY: Readonly<Record<Severity, number>> = {
  low: DEFAULT_ALERT_PREFS.slots.low.length,
  medium: DEFAULT_ALERT_PREFS.slots.medium.length,
  high: DEFAULT_ALERT_PREFS.slots.high.length,
};

/**
 * A Member's alert prefs as stored on their Profile, with defaults filled in. Profiles saved
 * before M4 carry the Handoff time as `digestAt`; that is read as `handoffAt`.
 */
export function readAlertPrefs(stored: unknown): AlertPrefs {
  const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const p = raw as Partial<AlertPrefs> & { digestAt?: unknown };
  const d = DEFAULT_ALERT_PREFS;
  return {
    slots: { low: p.slots?.low ?? d.slots.low, medium: p.slots?.medium ?? d.slots.medium, high: p.slots?.high ?? d.slots.high },
    quietStart: p.quietStart ?? d.quietStart,
    quietEnd: p.quietEnd ?? d.quietEnd,
    handoffAt: p.handoffAt ?? (typeof p.digestAt === "string" ? p.digestAt : d.handoffAt),
    overdueAlerts: p.overdueAlerts ?? d.overdueAlerts,
  };
}

function minutes(hhmm: string): number {
  const { hour, minute } = parseHHMM(hhmm);
  return hour * 60 + minute;
}

export function inQuietHours(t: number, prefs: AlertPrefs): boolean {
  const w = toWall(t);
  const m = w.hour * 60 + w.minute;
  const s = minutes(prefs.quietStart);
  const e = minutes(prefs.quietEnd);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** Ding times for the Pacific day containing `t`, with quiet-hour slots pushed to quiet end. */
export function dingSlotsForDay(item: Item, prefs: AlertPrefs, t: number): number[] {
  const w = toWall(t);
  const end = parseHHMM(prefs.quietEnd);
  const out = new Set<number>();
  for (const hhmm of prefs.slots[item.severity ?? "low"]) {
    const { hour, minute } = parseHHMM(hhmm);
    let slot = fromWall(w.year, w.month, w.day, hour, minute);
    if (inQuietHours(slot, prefs)) {
      const sw = toWall(slot);
      // Quiet window wraps midnight: evening slots move to tomorrow morning.
      const dayOffset = sw.hour * 60 + sw.minute >= minutes(prefs.quietStart) && minutes(prefs.quietStart) > minutes(prefs.quietEnd) ? 1 : 0;
      slot = fromWall(sw.year, sw.month, sw.day + dayOffset, end.hour, end.minute);
    }
    out.add(slot);
  }
  return [...out].sort((a, b) => a - b);
}

/** Who should be alerted about an item (SPEC §4.6). */
export function alertRecipients(item: Item, users: UserId[]): UserId[] {
  if (item.visibility.startsWith("private:")) return [item.visibility.slice("private:".length)];
  if (item.assigneeId) return [item.assigneeId];
  return users;
}

/**
 * Should the notifier ding this user about this item now?
 * `lastAlertedAt` is the last ding sent to this user for this item (NSTATE record).
 * Fires at most once per call; the notifier runs every 15 minutes.
 */
export function shouldDing(item: Item, prefs: AlertPrefs, lastAlertedAt: number | undefined, now: number): boolean {
  if (!prefs.overdueAlerts || item.archived) return false;
  if (status(item, now) !== "red") return false;
  const { nextDue } = schedule(item);
  if (nextDue === null) return false;
  const last = lastAlertedAt ?? 0;

  // First ding when it turns red, unless that happens during quiet hours.
  if (last < nextDue && !inQuietHours(now, prefs)) return true;

  // Then scheduled slots (yesterday's included, so slots pushed past midnight still fire).
  const slots = [...dingSlotsForDay(item, prefs, now - DAY), ...dingSlotsForDay(item, prefs, now)];
  return slots.some((s) => s <= now && s > last && s >= nextDue);
}
