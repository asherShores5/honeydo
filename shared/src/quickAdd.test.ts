// Seam 1 for m6/01: one line of shorthand becomes an item input, or says what it couldn't read.
import { describe, expect, it } from "vitest";
import { parseQuickAdd, type QuickAddContext } from "./quickAdd";

const ctx: QuickAddContext = {
  me: "sub-a",
  members: [
    { userId: "sub-a", names: ["Asher", "asher"] },
    { userId: "sub-b", names: ["Aubyn", "aubyn"] },
  ],
  tags: [
    { id: "category-baby-care", name: "Baby care", group: "Category" },
    { id: "category-kitchen", name: "Kitchen", group: "Category" },
    { id: "locale-kitchen", name: "Kitchen", group: "Locale" },
    { id: "time-of-day-evening", name: "Evening", group: "Time of day" },
  ],
};
const ok = (line: string) => {
  const r = parseQuickAdd(line, ctx);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.item;
};

const rec = (line: string) => {
  const item = ok(line);
  return item.kind === "chore" ? item.recurrence : undefined;
};

describe("quick-add shorthand", () => {
  it("reports an @name two Members share", () => {
    const twins = { ...ctx, members: [{ userId: "x", names: ["Sam"] }, { userId: "y", names: ["Sam"] }] };
    const r = parseQuickAdd("bath daily @sam", twins);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/@sam.*more than one/);
  });

  it("reads the story's example", () => {
    expect(ok("bath every 3d #baby @aubyn")).toEqual({
      kind: "chore", title: "bath", recurrence: { type: "interval", every: 3, unit: "days" },
      tags: ["category-baby-care"], assigneeId: "sub-b",
    });
  });

  it.each([
    ["every 3d", { every: 3, unit: "days" }],
    ["every 3 days", { every: 3, unit: "days" }],
    ["every 4h", { every: 4, unit: "hours" }],
    ["every 2 weeks", { every: 2, unit: "weeks" }],
    ["every day", { every: 1, unit: "days" }],
    ["daily", { every: 1, unit: "days" }],
    ["weekly", { every: 1, unit: "weeks" }],
  ] as const)("reads the Interval %s", (phrase, interval) => {
    expect(rec(`water plants ${phrase}`)).toEqual({ type: "interval", ...interval });
  });

  it("reads a weekday Calendar schedule, with a time", () => {
    expect(rec("trash every tue at 8pm")).toEqual({ type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" });
    expect(rec("bins every mon,thu at 07:30")).toEqual({ type: "calendar", freq: "weekly", byWeekday: [1, 4], at: "07:30" });
    expect(rec("recycling every fri")).toEqual({ type: "calendar", freq: "weekly", byWeekday: [5] });
  });

  it("is a plain Task without a Recurrence", () => {
    expect(ok("call the plumber")).toEqual({ kind: "task", title: "call the plumber", tags: [] });
  });

  it("takes a Tag by name, ignoring case and spaces, and @me", () => {
    expect(ok("bottles every 1d #Baby-care #evening @me")).toMatchObject({ tags: ["category-baby-care", "time-of-day-evening"], assigneeId: "sub-a" });
  });

  it("takes a Tag group-qualified when the name is in two groups", () => {
    expect(ok("wipe counters daily #locale-kitchen").tags).toEqual(["locale-kitchen"]);
  });

  it.each([
    ["weekly report", "weekly report"],
    ["daily standup notes", "daily standup notes"],
    ["pick up at 5pm", "pick up at 5pm"],
    ["meet at 3rd st", "meet at 3rd st"],
    ["every other thing", "every other thing"],
  ])("leaves shorthand-looking words in the title when they lead it: %s", (line, title) => {
    expect(ok(line)).toEqual({ kind: "task", title, tags: [] });
  });

  it.each([
    ["an unknown #tag", "bath daily #garage", /#garage/],
    ["an ambiguous #tag", "wipe daily #kitchen", /#kitchen.*Category.*Locale/],
    ["an unknown @name", "bath daily @bob", /@bob/],
    ["a bad time", "trash every tue at 25:00", /time/],
    ["no title", "every 3d #baby", /title/],
    ["an unknown unit", "call mom every 2 months", /every 2 months/],
    ["two schedules", "bath daily every tue", /one schedule/],
    ["a word after the shorthand", "bath every 3d tonight", /tonight/],
    ["too long an Interval", "repaint every 1001d", /1000/],
    ["a time without weekdays", "bath every 3d at 8pm", /weekdays/],
  ])("reports %s instead of guessing", (_what, line, msg) => {
    const r = parseQuickAdd(line, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(msg);
  });
});
