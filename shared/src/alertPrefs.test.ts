import { describe, expect, it } from "vitest";
import { DAY, fromWall } from "./time";
import { readAlertPrefs, shouldDing } from "./alerts";
import type { Chore } from "./types";

const dueAt = fromWall(2026, 10, 4, 12, 0);
const red: Chore = {
  id: "i1", title: "Baby bath", visibility: "shared", archived: false, createdBy: "a",
  createdAt: dueAt - 30 * DAY, updatedAt: dueAt, version: 1, tags: [], kind: "chore",
  recurrence: { type: "interval", every: 3, unit: "days" }, lastDoneAt: dueAt - 3 * DAY,
};

describe("stored alert prefs", () => {
  it("a pre-M4 profile's digestAt is its Handoff time", () => {
    const p = readAlertPrefs({ digestAt: "21:30", overdueAlerts: true });
    expect(p.handoffAt).toBe("21:30");
    expect(p).not.toHaveProperty("digestAt");
  });

  it("drops keys that aren't alert prefs", () => {
    expect(readAlertPrefs({ handoffAt: "20:00", volume: 11 })).not.toHaveProperty("volume");
  });

  it("missing prefs get the SPEC defaults", () => {
    expect(readAlertPrefs(null)).toEqual({
      slots: { low: ["09:00"], medium: ["09:00", "17:00"], high: ["09:00", "13:00", "19:00"] },
      quietStart: "21:00", quietEnd: "07:00", handoffAt: "20:00", overdueAlerts: true,
    });
  });

  it("overdue alerts off stops dings but keeps the Handoff time", () => {
    const p = readAlertPrefs({ digestAt: "21:30", overdueAlerts: false });
    expect(shouldDing(red, p, undefined, dueAt + 60_000)).toBe(false);
    expect(p.handoffAt).toBe("21:30");
  });

  it("legacy prefs still drive dings", () => {
    expect(shouldDing(red, readAlertPrefs({ digestAt: "21:30" }), undefined, dueAt + 60_000)).toBe(true);
  });
});
