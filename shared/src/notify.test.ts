// Seam 1 for the Notifier (m4/04): given these items, Members, notification state and the time,
// which Dings go out, to whom, and what each one says.
import { describe, expect, it } from "vitest";
import { DAY, HOUR, fromWall } from "./time";
import { DEFAULT_ALERT_PREFS } from "./alerts";
import { dingPayload, planDings, type DingState, type NotifyMember } from "./notify";
import type { AlertPrefs, Chore } from "./types";

const A = "sub-a";
const B = "sub-b";
const dueAt = fromWall(2026, 10, 4, 12, 0); // a Sunday, noon Pacific
const turnedRed = dueAt + 60_000;

const red: Chore = {
  id: "i1", title: "Baby bath", visibility: "shared", archived: false, createdBy: A,
  createdAt: dueAt - 30 * DAY, updatedAt: dueAt, version: 1, tags: ["t1"], notes: "use the blue tub",
  kind: "chore", recurrence: { type: "interval", every: 3, unit: "days" }, lastDoneAt: dueAt - 3 * DAY,
};

const both = (prefs: Partial<AlertPrefs> = {}): NotifyMember[] => [
  { userId: A, prefs: { ...DEFAULT_ALERT_PREFS, ...prefs } },
  { userId: B, prefs: { ...DEFAULT_ALERT_PREFS, ...prefs } },
];

const who = (dings: { userId: string; itemId: string }[]) => dings.map((d) => `${d.itemId}>${d.userId}`).sort();

describe("recipients", () => {
  it("a shared, unassigned item that turns red dings both Members", () => {
    expect(who(planDings([red], both(), [], turnedRed))).toEqual(["i1>sub-a", "i1>sub-b"]);
  });

  it("an assigned item dings only its Assignee", () => {
    expect(who(planDings([{ ...red, assigneeId: B }], both(), [], turnedRed))).toEqual(["i1>sub-b"]);
  });

  it("a Private item dings only its owner", () => {
    expect(who(planDings([{ ...red, visibility: `private:${A}` }], both(), [], turnedRed))).toEqual(["i1>sub-a"]);
  });

  it("a Member with overdue alerts off gets no Dings; the other still does", () => {
    const members = [{ userId: A, prefs: { ...DEFAULT_ALERT_PREFS, overdueAlerts: false } }, both()[1]];
    expect(who(planDings([red], members, [], turnedRed))).toEqual(["i1>sub-b"]);
  });
});

describe("Slot timing", () => {
  const dinged = (userId: string, at: number): DingState => ({ itemId: "i1", userId, lastAlertedAt: at });

  it("after the turn-to-red Ding, nothing until the next Slot", () => {
    expect(planDings([red], both(), [dinged(A, turnedRed), dinged(B, turnedRed)], dueAt + 3 * HOUR)).toEqual([]);
  });

  it("a low item's next Ding is the 09:00 Slot the next day", () => {
    const states = [dinged(A, turnedRed), dinged(B, turnedRed)];
    expect(planDings([red], both(), states, fromWall(2026, 10, 5, 8, 45))).toEqual([]);
    expect(who(planDings([red], both(), states, fromWall(2026, 10, 5, 9, 0)))).toEqual(["i1>sub-a", "i1>sub-b"]);
  });

  it("the same Slot never dings twice once its Ding is recorded", () => {
    const nine = fromWall(2026, 10, 5, 9, 0);
    expect(planDings([red], both(), [dinged(A, nine), dinged(B, nine)], nine + 15 * 60_000)).toEqual([]);
  });

  it("each Member's state is their own: one already dinged, the other still due", () => {
    expect(who(planDings([red], both(), [dinged(A, turnedRed)], turnedRed + 60_000))).toEqual(["i1>sub-b"]);
  });

  it("a high item dings at each of its three Slots, one run every 15 minutes", () => {
    const high = { ...red, severity: "high" as const };
    const at = (h: number) => fromWall(2026, 10, 5, h, 0);
    let last = turnedRed;
    const fired: number[] = [];
    for (let t = dueAt + 15 * 60_000; t < at(24); t += 15 * 60_000) {
      if (planDings([high], both().slice(0, 1), [dinged(A, last)], t).length) {
        fired.push(t);
        last = t;
      }
    }
    expect(fired).toEqual([fromWall(2026, 10, 4, 13, 0), fromWall(2026, 10, 4, 19, 0), at(9), at(13), at(19)]);
  });
});

describe("Quiet hours", () => {
  it("an item turning red in Quiet hours waits for the end of Quiet hours", () => {
    const nightDue = fromWall(2026, 10, 4, 23, 0);
    const night = { ...red, lastDoneAt: nightDue - 3 * DAY };
    expect(planDings([night], both(), [], nightDue + 30 * 60_000)).toEqual([]);
    expect(who(planDings([night], both(), [], fromWall(2026, 10, 5, 7, 0)))).toEqual(["i1>sub-a", "i1>sub-b"]);
  });

  it("a Slot inside one Member's Quiet hours moves to its end for that Member only", () => {
    const states: DingState[] = [A, B].map((userId) => ({ itemId: "i1", userId, lastAlertedAt: turnedRed }));
    const members = [{ userId: A, prefs: { ...DEFAULT_ALERT_PREFS, quietStart: "08:00", quietEnd: "10:00" } }, both()[1]];
    expect(who(planDings([red], members, states, fromWall(2026, 10, 5, 9, 0)))).toEqual(["i1>sub-b"]);
    const bAt9 = [states[0], { ...states[1], lastAlertedAt: fromWall(2026, 10, 5, 9, 0) }];
    expect(who(planDings([red], members, bAt9, fromWall(2026, 10, 5, 10, 0)))).toEqual(["i1>sub-a"]);
  });
});

describe("silent items", () => {
  it("a snoozed item doesn't ding until the snooze ends", () => {
    const snoozed = { ...red, snoozedUntil: dueAt + DAY };
    expect(planDings([snoozed], both(), [], turnedRed)).toEqual([]);
    expect(who(planDings([snoozed], both(), [], dueAt + DAY + 60_000))).toEqual(["i1>sub-a", "i1>sub-b"]);
  });

  it("an archived item never dings", () => {
    expect(planDings([{ ...red, archived: true }], both(), [], turnedRed)).toEqual([]);
  });

  it("a Finished task and a task not yet due don't ding", () => {
    const { recurrence: _r, ...rest } = red;
    const task = { ...rest, kind: "task" as const, dueAt };
    expect(planDings([{ ...task, lastDoneAt: dueAt - HOUR }], both(), [], turnedRed)).toEqual([]);
    expect(planDings([task], both(), [], dueAt - HOUR)).toEqual([]);
  });
});

describe("Ding payload", () => {
  it("names the item and deep-links to it", () => {
    expect(dingPayload(red, dueAt + 2 * DAY + HOUR)).toEqual({
      title: "Baby bath",
      body: "Overdue by 2 days",
      data: { kind: "ding", itemId: "i1", url: "/?item=i1" },
    });
  });

  it("says hours when it's less than a day overdue, and 'Overdue' at first", () => {
    expect(dingPayload(red, dueAt + 5 * HOUR).body).toBe("Overdue by 5 hours");
    expect(dingPayload(red, turnedRed).body).toBe("Overdue");
  });

  it("carries none of the item's other fields, so a Private item's notes, tags and owner never travel", () => {
    const priv = { ...red, visibility: `private:${A}` as const, assigneeId: A };
    const json = JSON.stringify(dingPayload(priv, turnedRed));
    for (const leak of ["blue tub", "t1", A, "private", "notes", "tags"]) expect(json).not.toContain(leak);
  });

  it("stays well under the 4 KB push limit for the longest title", () => {
    const long = { ...red, id: "x".repeat(36), title: "é".repeat(200) };
    expect(new TextEncoder().encode(JSON.stringify(dingPayload(long, turnedRed))).length).toBeLessThan(1024);
  });
});
