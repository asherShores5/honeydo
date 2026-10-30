import { describe, expect, it } from "vitest";
import { DAY, HOUR, fromWall } from "@aubi/shared";
import { doneAtFromInput, snoozeChoices, swipeAction, tomorrowMorning } from "./rowActions";

describe("swipe on a list row (m6/02)", () => {
  it("right is Done, left opens the row's actions, once past the threshold", () => {
    expect(swipeAction(90, 4)).toBe("done");
    expect(swipeAction(-90, -6)).toBe("actions");
  });

  it("a short drag or a tap does nothing", () => {
    expect(swipeAction(30, 0)).toBeNull();
    expect(swipeAction(0, 0)).toBeNull();
  });

  it("a mostly vertical drag is a scroll, not a swipe", () => {
    expect(swipeAction(80, 120)).toBeNull();
    expect(swipeAction(-70, 60)).toBeNull();
  });
});

describe("Done at… (m6/03)", () => {
  const now = fromWall(2026, 10, 5, 9, 0);

  it("reads a past Pacific time from the picker", () => {
    expect(doneAtFromInput("2026-10-05T07:30", now)).toEqual({ ok: true, at: fromWall(2026, 10, 5, 7, 30) });
  });

  it("accepts now", () => {
    expect(doneAtFromInput("2026-10-05T09:00", now)).toEqual({ ok: true, at: now });
  });

  it("rejects a future time and an empty picker", () => {
    expect(doneAtFromInput("2026-10-05T10:00", now).ok).toBe(false);
    expect(doneAtFromInput("", now).ok).toBe(false);
  });

  it("allows a minute of clock drift so 'now' on a slow phone still counts", () => {
    expect(doneAtFromInput("2026-10-05T09:00", now - 30_000).ok).toBe(true);
    expect(doneAtFromInput("2026-10-05T09:02", now).ok).toBe(false);
    expect(doneAtFromInput("2026-10-05T09:00", now - HOUR).ok).toBe(false);
  });
});

describe("Snooze choices", () => {
  it("tomorrow morning is 8am Pacific the next day, across a DST change too", () => {
    expect(tomorrowMorning(fromWall(2026, 10, 5, 22, 0))).toBe(fromWall(2026, 10, 6, 8, 0));
    expect(tomorrowMorning(fromWall(2026, 10, 31, 23, 30))).toBe(fromWall(2026, 11, 1, 8, 0)); // DST ends Nov 1
  });

  it("offers 3 hours, tomorrow 8am and 1 day", () => {
    const now = fromWall(2026, 10, 5, 9, 0);
    expect(snoozeChoices(now)).toEqual([
      { label: "3 hours", until: now + 3 * HOUR },
      { label: "Tomorrow 8am", until: fromWall(2026, 10, 6, 8, 0) },
      { label: "1 day", until: now + DAY },
    ]);
  });
});
