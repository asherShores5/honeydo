import { describe, expect, it } from "vitest";
import { DAY, HOUR, fromWall, toWall } from "./time";
import { defaultWarnWindow, schedule, status } from "./status";
import { DEFAULT_ALERT_PREFS, alertRecipients, dingSlotsForDay, shouldDing } from "./alerts";
import type { Chore, Item, Task } from "./types";

const T0 = fromWall(2026, 10, 1, 12, 0);

const BASE = {
  id: "i1", title: "Baby bath", visibility: "shared",
  archived: false, createdBy: "a", createdAt: T0 - 30 * DAY, updatedAt: T0, version: 1,
} as const;

function chore(over: Partial<Omit<Chore, "kind">> = {}): Chore {
  return { ...BASE, tags: [], kind: "chore", recurrence: { type: "interval", every: 3, unit: "days" }, ...over };
}

function task(over: Partial<Omit<Task, "kind">> = {}): Task {
  return { ...BASE, tags: [], kind: "task", title: "Call plumber", ...over };
}

describe("item shape", () => {
  it("a Chore can't exist without a Recurrence, and a Task can't carry one", () => {
    // @ts-expect-error a Chore must have a Recurrence
    const noRec: Item = { ...BASE, tags: [], kind: "chore" };
    // @ts-expect-error a Task can't have a Recurrence
    const taskRec: Item = { ...BASE, tags: [], kind: "task", recurrence: { type: "interval", every: 1, unit: "days" } };
    expect([noRec.kind, taskRec.kind]).toEqual(["chore", "task"]);
  });
});

describe("Done on a Chore always Resets", () => {
  const recs = [
    { type: "interval", every: 3, unit: "days" },
    { type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" },
    { type: "calendar", freq: "monthly", byMonthDay: [1], at: "09:00" },
  ] as const;
  for (const recurrence of recs) {
    it(`${JSON.stringify(recurrence)} is green, not done, right after Done`, () => {
      expect(status(chore({ recurrence, lastDoneAt: T0 }), T0 + 1000)).toBe("green");
    });
  }
});

describe("time", () => {
  it("round-trips Pacific wall clock across DST", () => {
    const ms = fromWall(2026, 11, 1, 1, 30); // fall-back day
    expect(toWall(ms).hour).toBe(1);
    expect(toWall(fromWall(2026, 3, 8, 12)).hour).toBe(12); // spring-forward day
  });
});

describe("warn window", () => {
  it("is max(1 day, 10%)", () => {
    expect(defaultWarnWindow(20 * DAY)).toBe(2 * DAY);
    expect(defaultWarnWindow(3 * DAY)).toBe(DAY);
  });
  it("is capped at 50% for short intervals", () => {
    expect(defaultWarnWindow(12 * HOUR)).toBe(6 * HOUR);
  });
});

describe("interval chores (baby bath every 3 days)", () => {
  const done = chore({ lastDoneAt: T0 });
  it("green after reset", () => expect(status(done, T0 + HOUR)).toBe("green"));
  it("yellow within 1 day of due", () => expect(status(done, T0 + 2 * DAY + HOUR)).toBe("yellow"));
  it("red once 3 days pass", () => expect(status(done, T0 + 3 * DAY)).toBe("red"));
  it("never-done chores are due now", () => expect(status(chore(), T0)).toBe("red"));
  it("snooze hides red", () =>
    expect(status({ ...done, snoozedUntil: T0 + 4 * DAY }, T0 + 3 * DAY)).toBe("snoozed"));
});

describe("calendar chores (trash weekly Tue 20:00)", () => {
  const rec = { type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" } as const;
  const tue = fromWall(2026, 10, 6, 20, 0); // Tue Oct 6 2026
  it("next due is the coming Tuesday", () => {
    expect(schedule(chore({ recurrence: rec, createdAt: tue - 3 * DAY })).nextDue).toBe(tue);
  });
  it("done early on Tuesday satisfies that Tuesday", () => {
    const s = schedule(chore({ recurrence: rec, lastDoneAt: tue - HOUR }));
    expect(s.nextDue).toBe(fromWall(2026, 10, 13, 20, 0));
  });
  it("done late (Wed) satisfies the missed one only", () => {
    const s = schedule(chore({ recurrence: rec, lastDoneAt: tue + DAY }));
    expect(s.nextDue).toBe(fromWall(2026, 10, 13, 20, 0));
  });
  it("monthly on the 31st falls back to the last day", () => {
    const m = { type: "calendar", freq: "monthly", byMonthDay: [31], at: "09:00" } as const;
    const s = schedule(chore({ recurrence: m, createdAt: fromWall(2026, 11, 1) }));
    expect(s.nextDue).toBe(fromWall(2026, 11, 30, 9, 0));
  });
});

describe("tasks", () => {
  const t = task({ dueAt: T0 + 2 * DAY });
  it("yellow 1 day before due", () => expect(status(t, T0 + DAY + HOUR)).toBe("yellow"));
  it("done once completed", () => expect(status({ ...t, lastDoneAt: T0 }, T0 + 5 * DAY)).toBe("done"));
  it("undated tasks stay green", () =>
    expect(status({ ...t, dueAt: undefined }, T0 + 100 * DAY)).toBe("green"));
});

describe("overdue dings", () => {
  const p = DEFAULT_ALERT_PREFS;
  const dueAt = fromWall(2026, 10, 4, 12, 0);
  const red = chore({ lastDoneAt: dueAt - 3 * DAY });

  it("dings when it turns red", () => expect(shouldDing(red, p, undefined, dueAt + 60_000)).toBe(true));
  it("not again until the next slot", () =>
    expect(shouldDing(red, p, dueAt + 60_000, dueAt + 2 * HOUR)).toBe(false));
  it("low severity: next ding is 9:00 tomorrow", () => {
    const nine = fromWall(2026, 10, 5, 9, 0);
    expect(shouldDing(red, p, dueAt + 60_000, nine - 60_000)).toBe(false);
    expect(shouldDing(red, p, dueAt + 60_000, nine + 60_000)).toBe(true);
  });
  it("medium also dings at 17:00", () =>
    expect(shouldDing({ ...red, severity: "medium" }, p, dueAt + 60_000, fromWall(2026, 10, 4, 17, 5))).toBe(true));
  it("high has 3 slots/day", () =>
    expect(dingSlotsForDay({ ...red, severity: "high" }, p, dueAt)).toHaveLength(3));
  it("turning red in quiet hours waits for morning", () => {
    const night = chore({ lastDoneAt: fromWall(2026, 10, 4, 23, 0) - 3 * DAY });
    expect(shouldDing(night, p, undefined, fromWall(2026, 10, 4, 23, 30))).toBe(false);
    expect(shouldDing(night, p, undefined, fromWall(2026, 10, 5, 7, 5))).toBe(true);
  });
  it("quiet-hour slots move to quiet end", () => {
    const late = { ...p, slots: { ...p.slots, low: ["22:00"] } };
    expect(dingSlotsForDay(red, late, dueAt)).toEqual([fromWall(2026, 10, 5, 7, 0)]);
  });
  it("recipients: assignee, private owner, else both", () => {
    expect(alertRecipients(red, ["a", "b"])).toEqual(["a", "b"]);
    expect(alertRecipients({ ...red, assigneeId: "b" }, ["a", "b"])).toEqual(["b"]);
    expect(alertRecipients({ ...red, visibility: "private:a" }, ["a", "b"])).toEqual(["a"]);
  });
});
