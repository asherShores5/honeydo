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

describe("quick-add shorthand", () => {
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
  ] as const)("reads the Interval %s", (phrase, rec) => {
    expect(ok(`water plants ${phrase}`).recurrence).toEqual({ type: "interval", ...rec });
  });

  it("reads a weekday Calendar schedule, with a time", () => {
    expect(ok("trash every tue at 8pm").recurrence).toEqual({ type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" });
    expect(ok("bins every mon,thu at 07:30").recurrence).toEqual({ type: "calendar", freq: "weekly", byWeekday: [1, 4], at: "07:30" });
    expect(ok("recycling every fri").recurrence).toEqual({ type: "calendar", freq: "weekly", byWeekday: [5] });
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
    ["an unknown #tag", "bath daily #garage", /#garage/],
    ["an ambiguous #tag", "wipe daily #kitchen", /#kitchen.*Category.*Locale/],
    ["an unknown @name", "bath daily @bob", /@bob/],
    ["a bad time", "trash every tue at 25:00", /time/],
    ["no title", "every 3d #baby", /title/],
  ])("reports %s instead of guessing", (_what, line, msg) => {
    const r = parseQuickAdd(line, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(msg);
  });
});
