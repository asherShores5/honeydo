import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const legacyProfile = (alertPrefs: Record<string, unknown>) => ({
  PK: "HH#aubi", SK: `USER#${h.A.userId}`, userId: h.A.userId, username: h.A.username,
  setupComplete: true, updatedAt: 1, alertPrefs,
});

describe("Handoff time rename", () => {
  it("a profile with only digestAt reads back with it as the Handoff time", async () => {
    h.db.seed(legacyProfile({ digestAt: "20:30", overdueAlerts: true }));
    const me = await h.call(h.A, "me");
    expect(me.alertPrefs.handoffAt).toBe("20:30");
    expect(me.alertPrefs).not.toHaveProperty("digestAt");
  });
});

describe("alert prefs validation", () => {
  const put = (alertPrefs: unknown) => h.call(h.A, "putProfile", { input: { alertPrefs: JSON.stringify(alertPrefs) } });

  it.each([
    ["Handoff time not HH:MM", { handoffAt: "8pm" }],
    ["Handoff time out of range", { handoffAt: "24:00" }],
    ["quiet start not HH:MM", { quietStart: "9" }],
    ["quiet end not HH:MM", { quietEnd: "7:00am" }],
    ["slot not HH:MM", { slots: { low: ["9am"], medium: ["09:00", "17:00"], high: ["09:00", "13:00", "19:00"] } }],
    ["two slots for low", { slots: { low: ["09:00", "10:00"], medium: ["09:00", "17:00"], high: ["09:00", "13:00", "19:00"] } }],
    ["one slot for medium", { slots: { low: ["09:00"], medium: ["09:00"], high: ["09:00", "13:00", "19:00"] } }],
    ["two slots for high", { slots: { low: ["09:00"], medium: ["09:00", "17:00"], high: ["09:00", "13:00"] } }],
    ["a Severity missing from slots", { slots: { low: ["09:00"], medium: ["09:00", "17:00"] } }],
    ["an unknown Severity in slots", { slots: { low: ["09:00"], medium: ["09:00", "17:00"], high: ["09:00", "13:00", "19:00"], urgent: ["09:00"] } }],
    ["overdue toggle not a boolean", { overdueAlerts: "no" }],
    ["an unknown key", { handoffAt: "20:00", volume: 11 }],
    ["the old digestAt key", { digestAt: "20:00" }],
    ["not an object", ["20:00"]],
  ])("rejects %s", async (_why, prefs) => {
    await expect(put(prefs)).rejects.toThrow();
  });

  it("accepts and reads back a full set of prefs", async () => {
    const prefs = {
      slots: { low: ["08:00"], medium: ["08:00", "18:00"], high: ["08:00", "12:00", "18:00"] },
      quietStart: "22:00", quietEnd: "06:30", handoffAt: "19:45", overdueAlerts: false,
    };
    await put(prefs);
    expect((await h.call(h.A, "me")).alertPrefs).toEqual(prefs);
  });
});

describe("overdue alerts toggle", () => {
  const put = (alertPrefs: unknown) => h.call(h.A, "putProfile", { input: { alertPrefs: JSON.stringify(alertPrefs) } });

  it("turning overdue alerts off leaves the Handoff time as set", async () => {
    await put({ handoffAt: "19:15", overdueAlerts: true });
    const me = await put({ overdueAlerts: false });
    expect(me.alertPrefs.overdueAlerts).toBe(false);
    expect(me.alertPrefs.handoffAt).toBe("19:15");
  });

  it("a legacy digestAt survives turning overdue alerts off", async () => {
    h.db.seed(legacyProfile({ digestAt: "21:00", overdueAlerts: true }));
    await put({ overdueAlerts: false });
    expect((await h.call(h.A, "me")).alertPrefs).toMatchObject({ handoffAt: "21:00", overdueAlerts: false });
  });
});
