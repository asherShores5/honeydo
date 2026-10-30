// The Editor's Warn window field (m6/04): a number plus hours/days, empty = the default.
import { DAY, HOUR, schedule, warnWindowMax, type Recurrence } from "@aubi/shared";

export type WarnUnit = "hours" | "days";
const UNIT: Record<WarnUnit, number> = { hours: HOUR, days: DAY };

export function warnToInput(ms: number | undefined): { value: string; unit: WarnUnit } {
  if (ms === undefined) return { value: "", unit: "days" };
  return ms % DAY === 0 ? { value: String(ms / DAY), unit: "days" } : { value: String(Math.round(ms / HOUR)), unit: "hours" };
}

/** The field's value in ms (undefined = default), or why it can't be saved. Mirrors the server's rule. */
export function warnFromInput(value: string, unit: WarnUnit, rec: Recurrence): { ok: true; ms: number | undefined } | { ok: false; error: string } {
  if (!value.trim()) return { ok: true, ms: undefined };
  const ms = Number(value) * UNIT[unit];
  if (!Number.isFinite(ms) || ms <= 0) return { ok: false, error: "Use a number above 0." };
  if (ms > warnWindowMax(rec)) return { ok: false, error: "That's longer than how often it repeats." };
  return { ok: true, ms };
}

/** The Warn window this Recurrence gets without an override. */
export function defaultWarnFor(rec: Recurrence, now: number): number {
  return schedule({
    id: "", title: "", tags: [], visibility: "shared", archived: false, createdBy: "", createdAt: now,
    updatedAt: now, version: 0, kind: "chore", recurrence: rec,
  }).warnWindow;
}
