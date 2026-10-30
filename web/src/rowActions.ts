// List-row actions (m6/02, m6/03): what a swipe means, Snooze choices, and the "Done at…" picker.
import { CLOCK_SLACK_MS, DAY, HOUR, fromWall, toWall } from "@aubi/shared";
import { fromLocalInput } from "./format";

/** How far a row must travel sideways before letting go counts as a swipe. */
export const SWIPE_MIN_PX = 70;
/** A drag steeper than this (vertical / horizontal) is a scroll. */
const SWIPE_MAX_SLOPE = 0.6;
/** "Tomorrow morning" Snoozes until this Pacific hour. */
const MORNING_HOUR = 8;

/** Right = Done, left = the row's actions (Snooze, Done at…); short or steep drags are taps or scrolls. */
export function swipeAction(dx: number, dy: number): "done" | "actions" | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_SLOPE) return null;
  return dx > 0 ? "done" : "actions";
}

/** Tomorrow at MORNING_HOUR, Pacific. */
export function tomorrowMorning(now: number): number {
  const w = toWall(now);
  return fromWall(w.year, w.month, w.day + 1, MORNING_HOUR, 0);
}

/** One set of Snooze choices for list rows and the Editor. */
export function snoozeChoices(now: number): { label: string; until: number }[] {
  return [
    { label: "3 hours", until: now + 3 * HOUR },
    { label: "Tomorrow 8am", until: tomorrowMorning(now) },
    { label: "1 day", until: now + DAY },
  ];
}

export function doneAtFromInput(value: string, now: number): { ok: true; at: number } | { ok: false; error: string } {
  const at = fromLocalInput(value);
  if (at === undefined) return { ok: false, error: "Pick when it was done." };
  if (at > now + CLOCK_SLACK_MS) return { ok: false, error: "That's in the future." };
  return { ok: true, at };
}
