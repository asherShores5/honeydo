import { describe, expect, it } from "vitest";
import { canSee, parseRecurrence, validateItemInput, validateProfileInput, type ItemInput } from "./rules";

const base: ItemInput = {
  id: "bath", kind: "chore", title: " Baby bath ", tags: ["baby", "baby"], visibility: "shared",
  recurrence: JSON.stringify({ type: "interval", every: 3, unit: "days" }), archived: false,
};

describe("visibility", () => {
  it("shared and own-private only", () => {
    expect(canSee("shared", "a")).toBe(true);
    expect(canSee("private:a", "a")).toBe(true);
    expect(canSee("private:b", "a")).toBe(false);
  });
  it("cannot create items private to the partner", () => {
    expect(() => validateItemInput({ ...base, visibility: "private:b" }, "a", ["a", "b"])).toThrow(/Forbidden|private/);
  });
});

describe("item validation", () => {
  it("trims title, dedupes tags, parses recurrence", () => {
    const f = validateItemInput(base, "a", ["a", "b"]);
    expect(f.title).toBe("Baby bath");
    expect(f.tags).toEqual(["baby"]);
    expect(f.recurrence).toEqual({ type: "interval", every: 3, unit: "days" });
  });
  it("chores require recurrence; tasks drop it", () => {
    expect(() => validateItemInput({ ...base, recurrence: null }, "a", [])).toThrow();
    expect(validateItemInput({ ...base, kind: "task", dueAt: 5 }, "a", []).recurrence).toBeUndefined();
  });
  it("rejects unknown assignee and severity", () => {
    expect(() => validateItemInput({ ...base, assigneeId: "zed" }, "a", ["a", "b"])).toThrow();
    expect(() => validateItemInput({ ...base, severity: "urgent" }, "a", [])).toThrow();
  });
});

describe("recurrence parsing", () => {
  it("weekly calendar, sorted and deduped", () => {
    expect(parseRecurrence({ type: "calendar", freq: "weekly", byWeekday: [4, 2, 2], at: "20:00" })).toEqual({
      type: "calendar", freq: "weekly", byWeekday: [2, 4], at: "20:00",
    });
  });
  it("rejects bad days/times", () => {
    expect(() => parseRecurrence({ type: "calendar", freq: "weekly", byWeekday: [7] })).toThrow();
    expect(() => parseRecurrence({ type: "calendar", freq: "monthly", byMonthDay: [1], at: "25:00" })).toThrow();
    expect(() => parseRecurrence({ type: "interval", every: 0, unit: "days" })).toThrow();
  });
});

describe("profile validation", () => {
  it("setup requires a Handoff time", () => {
    expect(() => validateProfileInput({ setupComplete: true })).toThrow(/Handoff time/);
    expect(validateProfileInput({ setupComplete: true, alertPrefs: JSON.stringify({ handoffAt: "20:30" }) }).setupComplete).toBe(true);
  });
  it("rejects malformed Handoff time", () => {
    expect(() => validateProfileInput({ alertPrefs: { handoffAt: "8pm" } })).toThrow();
  });
});
