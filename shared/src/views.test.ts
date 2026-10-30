// Seam 1 for M5 Views: what each view shows, given items, Tags, Completions and the time.
import { describe, expect, it } from "vitest";
import { DAY, HOUR, fromWall } from "./time";
import { calendarDays, historyStats, sortItems, tagBoard, todayGroups, type ViewTag } from "./views";
import type { Chore, Task } from "./types";

const now = fromWall(2026, 10, 5, 9, 0); // Mon 09:00 Pacific

const base = {
  visibility: "shared" as const, archived: false, createdBy: "a", createdAt: now - 30 * DAY,
  updatedAt: now - 30 * DAY, version: 1, tags: [] as string[],
};
/** An interval Chore due at `due` (every 3 days, last done 3 days before). */
const chore = (id: string, due: number, over: Partial<Chore> = {}): Chore => ({
  ...base, id, title: id, kind: "chore", recurrence: { type: "interval", every: 3, unit: "days" }, lastDoneAt: due - 3 * DAY, ...over,
});
const task = (id: string, over: Partial<Task> = {}): Task => ({ ...base, id, title: id, kind: "task", ...over });

const tod = (name: string, order: number): ViewTag => ({ id: `time-of-day-${name.toLowerCase()}`, name, group: "Time of day", order });
const MORNING = tod("Morning", 1);
const EVENING = tod("Evening", 3);
const KITCHEN: ViewTag = { id: "locale-kitchen", name: "Kitchen", group: "Locale", order: 1 };
const TAGS = [EVENING, KITCHEN, MORNING];

const ids = (groups: ReturnType<typeof todayGroups>) => groups.map((g) => [g.tag?.name ?? null, g.items.map((i) => i.id)]);

describe("Today view", () => {
  it("groups today's items by Time-of-day Tag in the group's order, untagged last", () => {
    const groups = todayGroups([
      chore("bath", now + 10 * HOUR, { tags: [EVENING.id] }),
      chore("dishes", now + 2 * HOUR, { tags: [KITCHEN.id] }),
      chore("vitamins", now + HOUR, { tags: [MORNING.id] }),
    ], TAGS, now);
    expect(ids(groups)).toEqual([["Morning", ["vitamins"]], ["Evening", ["bath"]], [null, ["dishes"]]]);
  });

  it("shows only items due today, red, or yellow", () => {
    const groups = todayGroups([
      chore("overdue", now - 2 * DAY),
      chore("tonight", now + 14 * HOUR), // 23:00 today
      chore("tomorrow-green", fromWall(2026, 10, 6, 21, 0), { warnWindow: HOUR }),
      chore("tomorrow-yellow", fromWall(2026, 10, 6, 8, 0)), // 1-day Warn window: yellow now
      chore("snoozed", now - DAY, { snoozedUntil: now + DAY }),
      chore("archived", now - DAY, { archived: true }),
      task("finished", { dueAt: now + HOUR, lastDoneAt: now - HOUR }),
      task("undated"),
      task("call-plumber", { dueAt: now + 3 * HOUR }),
    ], TAGS, now);
    expect(ids(groups)).toEqual([[null, ["overdue", "call-plumber", "tonight", "tomorrow-yellow"]]]);
  });
});

describe("Calendar", () => {
  const start = fromWall(2026, 10, 4); // Sun Oct 4, the day before `now`
  const trash: Chore = {
    ...base, id: "trash", title: "Take out trash", kind: "chore", lastDoneAt: fromWall(2026, 9, 29, 20, 0),
    recurrence: { type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" },
  };
  const day = (days: ReturnType<typeof calendarDays>, d: number) =>
    days.find((x) => x.day === d)!.entries.map((e) => `${e.kind}:${e.itemId}`);

  it("projects Chores' Next due forward and shows Tasks on their due date", () => {
    const days = calendarDays([
      chore("bath", fromWall(2026, 10, 6, 9, 0)), // every 3 days
      trash, // Tuesdays 20:00
      task("plumber", { dueAt: fromWall(2026, 10, 7, 10, 0) }),
      task("undated"),
    ], [], start, 10, now);
    expect(days.map((d) => d.day)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(day(days, 6)).toEqual(["due:bath", "due:trash"]);
    expect(day(days, 7)).toEqual(["due:plumber"]);
    expect(day(days, 9)).toEqual(["due:bath"]);
    expect(day(days, 12)).toEqual(["due:bath"]);
    expect(day(days, 13)).toEqual(["due:trash"]);
    expect(day(days, 8)).toEqual([]);
  });

  it("shows past Completions on their day, oldest first", () => {
    const days = calendarDays([chore("bath", fromWall(2026, 10, 7, 9, 0))], [
      { itemId: "bath", by: "b", at: fromWall(2026, 10, 4, 19, 0) },
      { itemId: "bath", by: "a", at: fromWall(2026, 10, 4, 8, 0) },
      { itemId: "gone", by: "a", at: fromWall(2026, 10, 4, 9, 0) },
    ], start, 3, now);
    expect(days[0].entries).toEqual([
      { kind: "done", itemId: "bath", title: "bath", at: fromWall(2026, 10, 4, 8, 0), by: "a" },
      { kind: "done", itemId: "bath", title: "bath", at: fromWall(2026, 10, 4, 19, 0), by: "b" },
    ]);
  });

  it("projects an overdue Chore from now, not from its missed Next due", () => {
    const days = calendarDays([chore("bath", fromWall(2026, 10, 3, 9, 0))], [], start, 10, now); // 2 days overdue
    expect(days.filter((d) => d.entries.length).map((d) => d.day)).toEqual([8, 11]); // now + 3d, + 6d
  });

  it("stays bounded for a long-overdue hourly Chore", () => {
    const hourly = chore("feed", now - 60 * DAY, { recurrence: { type: "interval", every: 1, unit: "hours" } });
    const days = calendarDays([hourly], [], start, 2, now);
    expect(days.flatMap((d) => d.entries)).toHaveLength(14); // hourly from now: Oct 5 10:00 to 23:00
  });

  it("leaves out archived and finished items' due dates", () => {
    const days = calendarDays([
      chore("old", fromWall(2026, 10, 5, 12, 0), { archived: true }),
      task("finished", { dueAt: fromWall(2026, 10, 5, 12, 0), lastDoneAt: now - HOUR }),
    ], [], start, 3, now);
    expect(days.flatMap((d) => d.entries)).toEqual([]);
  });
});

describe("Tag board", () => {
  const NURSERY: ViewTag = { id: "locale-nursery", name: "Nursery", group: "Locale", order: 0 };
  const BATHROOM: ViewTag = { id: "locale-bathroom", name: "Bathroom", group: "Locale", order: 2 };
  const OUTSIDE: ViewTag = { id: "locale-outside", name: "Outside", group: "Locale", order: 3 };
  const LOCALES = [KITCHEN, OUTSIDE, BATHROOM, NURSERY, MORNING];

  it("has one column per Tag in the chosen group's order, empty ones included, untagged last", () => {
    const cols = tagBoard([
      chore("bath", now + DAY, { tags: [BATHROOM.id, NURSERY.id] }),
      chore("dishes", now - HOUR, { tags: [KITCHEN.id, MORNING.id] }),
      chore("vitamins", now + HOUR, { tags: [MORNING.id] }),
    ], LOCALES, "Locale", now);
    expect(ids(cols)).toEqual([
      ["Nursery", ["bath"]],
      ["Kitchen", ["dishes"]],
      ["Bathroom", ["bath"]],
      ["Outside", []],
      [null, ["vitamins"]],
    ]);
  });

  it("leaves out archived and finished items and sorts each column most urgent first", () => {
    const cols = tagBoard([
      chore("later", now + 2 * DAY, { tags: [KITCHEN.id] }),
      chore("late", now - DAY, { tags: [KITCHEN.id] }),
      chore("old", now - DAY, { tags: [KITCHEN.id], archived: true }),
      task("finished", { tags: [KITCHEN.id], lastDoneAt: now - HOUR }),
    ], LOCALES, "Locale", now);
    expect(ids(cols)[1]).toEqual(["Kitchen", ["late", "later"]]);
  });
});

describe("History & stats", () => {
  const from = fromWall(2026, 9, 1);
  const to = fromWall(2026, 10, 1);
  const at = (d: number, h = 9) => fromWall(2026, 9, d, h, 0);
  const done = (itemId: string, by: string, t: number) => ({ itemId, by, at: t });
  const bath = chore("bath", now); // every 3 days
  const trash: Chore = { ...base, id: "trash", title: "trash", kind: "chore", recurrence: { type: "calendar", freq: "weekly", byWeekday: [2] } };
  const plumber = task("plumber", { archived: true, lastDoneAt: at(20) });

  it("counts each Member's Completions in the period, Finished Tasks included", () => {
    const stats = historyStats([bath, trash, plumber], [
      done("bath", "a", at(2)), done("bath", "b", at(5)), done("bath", "a", at(9)),
      done("trash", "b", at(8)), done("plumber", "b", at(20)),
      done("bath", "a", fromWall(2026, 8, 30)), // before the period
      done("gone", "a", at(3)), // item not visible
    ], ["a", "b"], from, to);
    expect(stats.byMember).toEqual([{ userId: "b", count: 3 }, { userId: "a", count: 2 }]);
  });

  it("lists Members with no Completions as zero", () => {
    expect(historyStats([bath], [done("bath", "a", at(2))], ["a", "b"], from, to).byMember)
      .toEqual([{ userId: "a", count: 1 }, { userId: "b", count: 0 }]);
  });

  it("compares each Interval Chore's target with its average actual interval", () => {
    const stats = historyStats([bath, trash], [
      done("bath", "a", at(2)), done("bath", "b", at(6)), done("bath", "a", at(11)),
      done("trash", "b", at(8)),
    ], ["a", "b"], from, to);
    expect(stats.chores).toEqual([
      { itemId: "bath", title: "bath", targetMs: 3 * DAY, actualMs: 4.5 * DAY, count: 3 },
    ]);
  });

  it("has no actual interval for a Chore done fewer than twice", () => {
    const stats = historyStats([bath], [done("bath", "a", at(2))], ["a"], from, to);
    expect(stats.chores).toEqual([{ itemId: "bath", title: "bath", targetMs: 3 * DAY, actualMs: null, count: 1 }]);
  });
});

describe("Saved view sort", () => {
  const items = [
    chore("soon", 0, { title: "apples", lastDoneAt: now - 2 * DAY }), // due in 1 day
    chore("overdue", 0, { title: "Bath", lastDoneAt: now - 5 * DAY }), // 2 days overdue
    task("undated", { title: "Call plumber" }),
  ];
  it.each([
    ["urgency", ["overdue", "soon", "undated"]],
    ["title", ["soon", "overdue", "undated"]], // apples, Bath, Call plumber (case-insensitive)
    ["lastDone", ["undated", "overdue", "soon"]], // never done, then longest since last Done
  ] as const)("sorts by %s", (sort, expected) => {
    expect(sortItems(items, sort, now).map((i) => i.id)).toEqual(expected);
  });
});
