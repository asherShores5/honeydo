import { describe, expect, it } from "vitest";
import { HOUR, fromWall } from "@aubi/shared";
import { doneAtFromInput, swipeAction } from "./rowActions";

describe("swipe on a list row (m6/02)", () => {
  it("right is Done, left is Snooze, once past the threshold", () => {
    expect(swipeAction(90, 4)).toBe("done");
    expect(swipeAction(-90, -6)).toBe("snooze");
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
