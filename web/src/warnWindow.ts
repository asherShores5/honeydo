// The Editor's Warn window field (m6/04): a number plus hours/days, empty = the default.
import { DAY, UNIT_MS, warnWindowProblem, type Recurrence } from "@aubi/shared";

export type WarnUnit = "hours" | "days";

export function warnToInput(ms: number | undefined): { value: string; unit: WarnUnit } {
  if (ms === undefined) return { value: "", unit: "days" };
  return ms % DAY === 0 ? { value: String(ms / DAY), unit: "days" } : { value: String(Math.round(ms / UNIT_MS.hours)), unit: "hours" };
}

/** The field's value in ms (undefined = the default), or why it can't be saved (the server's rule). */
export function warnFromInput(value: string, unit: WarnUnit, rec: Recurrence): { ok: true; ms: number | undefined } | { ok: false; error: string } {
  if (!value.trim()) return { ok: true, ms: undefined };
  const ms = Number(value) * UNIT_MS[unit];
  const error = warnWindowProblem(ms, rec);
  return error ? { ok: false, error } : { ok: true, ms };
}
