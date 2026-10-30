// List-row actions (m6/02, m6/03): what a swipe means, and reading the "Done at…" picker.
import { fromLocalInput } from "./format";

/** How far a row must travel sideways before letting go counts as a swipe. */
export const SWIPE_MIN_PX = 70;
/** The server also allows a minute ahead (device clocks drift). */
const CLOCK_SLACK_MS = 60_000;

/** Right = Done, left = Snooze; short or mostly vertical drags are taps or scrolls. */
export function swipeAction(dx: number, dy: number): "done" | "snooze" | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx) * 0.6) return null;
  return dx > 0 ? "done" : "snooze";
}

export function doneAtFromInput(value: string, now: number): { ok: true; at: number } | { ok: false; error: string } {
  const at = fromLocalInput(value);
  if (at === undefined) return { ok: false, error: "Pick when it was done." };
  if (at > now + CLOCK_SLACK_MS) return { ok: false, error: "That's in the future." };
  return { ok: true, at };
}
