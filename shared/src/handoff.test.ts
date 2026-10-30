// Seam 1 for the Handoff (m4/06): what one Member's Handoff says, when it is due, and how it fits
// in a push.
import { describe, expect, it } from "vitest";
import { DAY, HOUR, fromWall } from "./time";
import { DEFAULT_ALERT_PREFS } from "./alerts";
import { HANDOFF_PAYLOAD_MAX_BYTES, buildHandoff, handoffPayload, planHandoffs, type HandoffState } from "./handoff";
import type { NotifyMember } from "./notify";
import type { AlertPrefs, Chore, Completion, Item, Task } from "./types";

const A = "sub-a";
const B = "sub-b";
const names = { [A]: "Asher", [B]: "Aubyn" };
const now = fromWall(2026, 10, 5, 20, 0); // Mon 20:00 Pacific
const since = now - DAY;
const until = now + DAY;

const base = {
  visibility: "shared" as const, archived: false, createdBy: A, createdAt: now - 30 * DAY,
  updatedAt: now - 30 * DAY, version: 1, tags: [], notes: "notes stay home",
};
const chore = (id: string, title: string, over: Partial<Chore> = {}): Chore => ({
  ...base, id, title, kind: "chore", recurrence: { type: "interval", every: 3, unit: "days" }, lastDoneAt: now - HOUR, ...over,
});
const task = (id: string, title: string, over: Partial<Task> = {}): Task => ({ ...base, id, title, kind: "task", ...over });
const done = (itemId: string, by: string, at: number): Completion => ({ itemId, by, at, note: "a note" });

const forA = (items: Item[], completions: Completion[] = []) =>
  buildHandoff({ userId: A, items, completions, names, since, until, now });

describe("done since the last Handoff", () => {
  it("lists Completions after `since`, oldest first, with who did them", () => {
    const items = [chore("bath", "Baby bath"), chore("trash", "Trash")];
    const c = forA(items, [
      done("trash", A, now - 2 * HOUR),
      done("bath", B, now - 5 * HOUR),
      done("bath", B, since - HOUR), // before the last Handoff
    ]);
    expect(c.done).toEqual([
      { itemId: "bath", title: "Baby bath", by: B, byName: "Aubyn", at: now - 5 * HOUR },
      { itemId: "trash", title: "Trash", by: A, byName: "you", at: now - 2 * HOUR },
    ]);
    expect(c.counts.done).toBe(2);
  });

  it("includes finished (archived) Tasks", () => {
    const c = forA([task("t1", "Call the vet", { archived: true, lastDoneAt: now - HOUR })], [done("t1", B, now - HOUR)]);
    expect(c.done.map((d) => d.title)).toEqual(["Call the vet"]);
  });

  it("leaves out Completions stamped Private to the partner, even on an Item now shared", () => {
    const items = [chore("bath", "Baby bath")];
    const c = forA(items, [
      { ...done("bath", B, now - 3 * HOUR), visibility: `private:${B}` },
      { ...done("bath", B, now - 2 * HOUR), visibility: "shared" },
      done("bath", B, now - HOUR), // written before stamping: shared
    ]);
    expect(c.done.map((d) => d.at)).toEqual([now - 2 * HOUR, now - HOUR]);
  });

  it("keeps the recipient's own Private-stamped Completions", () => {
    const c = forA([chore("bath", "Baby bath")], [{ ...done("bath", A, now - HOUR), visibility: `private:${A}` }]);
    expect(c.done.map((d) => d.at)).toEqual([now - HOUR]);
  });
});

describe("summary lines", () => {
  it("one line per non-empty section, naming who did each thing", () => {
    const items = [
      chore("bath", "Baby bath", { lastDoneAt: now - 3 * DAY + 2 * HOUR }),
      chore("trash", "Trash"),
      task("vet", "Call the vet", { dueAt: now - DAY }),
    ];
    const c = forA(items, [done("bath", B, now - 5 * HOUR), done("trash", A, now - 2 * HOUR)]);
    expect(c.lines).toEqual([
      "Done: Baby bath (Aubyn), Trash (you)",
      "Overdue: Call the vet",
      "Due before next Handoff: Baby bath",
    ]);
  });

  it("says so when there is nothing to report", () => {
    expect(forA([]).lines).toEqual(["Nothing done, overdue or due."]);
  });
});

describe("push payload", () => {
  const bytes = (p: unknown) => new TextEncoder().encode(JSON.stringify(p)).length;

  it("carries the summary lines and opens the app", () => {
    const c = forA([task("vet", "Call the vet", { dueAt: now - DAY })]);
    expect(handoffPayload(c)).toEqual({ title: "Handoff", body: "Overdue: Call the vet", data: { kind: "handoff", url: "/" } });
  });

  it("a huge Handoff is cut to fit the cap with '+N more', and the counts stay whole", () => {
    // 3 x 150 items with 200-character, multi-byte titles: ~180 KB untrimmed.
    const long = (n: number) => `${n} ` + "é".repeat(197);
    const items: Item[] = [];
    const completions: Completion[] = [];
    for (let n = 0; n < 150; n++) {
      items.push(chore(`d${n}`, long(n)));
      completions.push(done(`d${n}`, B, now - HOUR - n));
      items.push(task(`o${n}`, long(n), { dueAt: now - HOUR - n }));
      items.push(task(`s${n}`, long(n), { dueAt: now + HOUR + n }));
    }
    const c = forA(items, completions);
    const p = handoffPayload(c);

    expect(bytes(p)).toBeLessThanOrEqual(HANDOFF_PAYLOAD_MAX_BYTES);
    expect(HANDOFF_PAYLOAD_MAX_BYTES).toBeLessThanOrEqual(3072); // room for aes128gcm under the 4 KB push limit
    const lines = p.body.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Done: .+, \+\d+ more$/);
    expect(lines[1]).toMatch(/^Overdue: .+, \+\d+ more$/);
    expect(lines[2]).toMatch(/^Due before next Handoff: .+, \+\d+ more$/);
    // Each line still accounts for all 150 entries.
    for (const line of lines) {
      const shown = line.split(": ")[1].split(", ");
      const more = Number(shown.pop()!.match(/\+(\d+) more/)![1]);
      expect(shown.length + more).toBe(150);
    }
    expect(c.counts).toEqual({ done: 150, overdue: 150, dueBeforeNext: 150 });
  });

  it("a Handoff that fits is sent whole", () => {
    const items = Array.from({ length: 10 }, (_, n) => task(`o${n}`, `Task ${n}`, { dueAt: now - HOUR - n }));
    expect(handoffPayload(forA(items)).body).not.toContain("more");
  });
});

describe("when a Handoff is due", () => {
  const members = (prefsA: Partial<AlertPrefs> = {}, prefsB: Partial<AlertPrefs> = {}): NotifyMember[] => [
    { userId: A, name: "Asher", prefs: { ...DEFAULT_ALERT_PREFS, ...prefsA } },
    { userId: B, name: "Aubyn", prefs: { ...DEFAULT_ALERT_PREFS, handoffAt: "21:30", ...prefsB } },
  ];
  const at = (day: number, h: number, m = 0) => fromWall(2026, 10, day, h, m);
  const plan = (states: HandoffState[], t: number, ms = members()) => planHandoffs([], [], ms, states, t);
  const whoGets = (states: HandoffState[], t: number, ms = members()) => plan(states, t, ms).map((p) => p.userId);
  const sentAt = (userId: string, t: number): HandoffState => ({ userId, lastHandoffAt: t });

  it("nothing before a Member's Handoff time; each Member at their own time", () => {
    expect(whoGets([], at(5, 19, 45))).toEqual([]);
    expect(whoGets([], at(5, 20, 0))).toEqual([A]);
    expect(whoGets([sentAt(A, at(5, 20, 0))], at(5, 21, 30))).toEqual([B]);
  });

  it("at most once per Pacific day", () => {
    const states = [sentAt(A, at(5, 20, 0)), sentAt(B, at(5, 21, 30))];
    expect(whoGets(states, at(5, 20, 15))).toEqual([]);
    expect(whoGets(states, at(5, 23, 45))).toEqual([]);
    expect(whoGets(states, at(6, 0, 0))).toEqual([]);
    expect(whoGets(states, at(6, 20, 0))).toEqual([A]);
  });

  it("moving the Handoff time later after today's was sent doesn't send a second one", () => {
    expect(whoGets([sentAt(A, at(5, 20, 0))], at(5, 22, 0), members({ handoffAt: "22:00" }))).not.toContain(A);
  });

  it("a Handoff skipped by an outage fires late the same day, but not the next morning", () => {
    const yesterday = sentAt(A, at(4, 20, 0));
    expect(whoGets([yesterday], at(5, 23, 45))).toContain(A);
    expect(whoGets([yesterday], at(6, 0, 15))).not.toContain(A);
  });

  it("sends even when overdue alerts are off", () => {
    expect(whoGets([], at(5, 20, 0), members({ overdueAlerts: false }))).toEqual([A]);
  });

  it("covers the time since the last Handoff (or the last day, the first time) up to the next one", () => {
    const [first] = plan([], at(5, 20, 0));
    expect(first).toMatchObject({ userId: A, seen: undefined });
    expect([first.content.since, first.content.until]).toEqual([at(5, 20, 0) - DAY, at(6, 20, 0)]);

    const [late] = plan([sentAt(A, at(4, 20, 0))], at(5, 22, 15));
    expect(late).toMatchObject({ userId: A, seen: at(4, 20, 0) });
    expect([late.content.since, late.content.until]).toEqual([at(4, 20, 0), at(6, 20, 0)]);
  });

  it("names the partner in the content", () => {
    const items = [chore("bath", "Baby bath")];
    const [p] = planHandoffs(items, [done("bath", B, at(5, 18, 0))], members(), [], at(5, 20, 0));
    expect(p.content.lines).toEqual(["Done: Baby bath (Aubyn)"]);
  });
});

describe("Private items", () => {
  const mine = { visibility: `private:${A}` as const };
  const theirs = { visibility: `private:${B}` as const };
  const items = [
    chore("myDone", "My done", mine), chore("theirDone", "Their done", theirs),
    task("myLate", "My late", { ...mine, dueAt: now - HOUR }), task("theirLate", "Their late", { ...theirs, dueAt: now - HOUR }),
    task("mySoon", "My soon", { ...mine, dueAt: now + HOUR }), task("theirSoon", "Their soon", { ...theirs, dueAt: now + HOUR }),
  ];
  const completions = [done("myDone", A, now - HOUR), done("theirDone", B, now - HOUR)];

  it("the recipient's own Private items are in their Handoff", () => {
    const c = forA(items, completions);
    expect([...c.done, ...c.overdue, ...c.dueBeforeNext].map((l) => l.itemId).sort()).toEqual(["myDone", "myLate", "mySoon"]);
  });

  it("the partner's Private items are neither counted nor named", () => {
    const c = forA(items, completions);
    expect(c.counts).toEqual({ done: 1, overdue: 1, dueBeforeNext: 1 });
    const json = JSON.stringify(c);
    for (const leak of ["their", "Their", `private:${B}`]) expect(json).not.toContain(leak);
  });

  it("a Completion whose item is gone is left out", () => {
    expect(forA([], [done("gone", B, now - HOUR)]).done).toEqual([]);
  });
});

describe("overdue", () => {
  it("lists red items, most overdue first, with their due time", () => {
    const items = [
      chore("dishes", "Dishes", { lastDoneAt: now - 3 * DAY - HOUR }), // due an hour ago
      task("vet", "Call the vet", { dueAt: now - 2 * DAY }),
      chore("fine", "Water plants", { lastDoneAt: now - HOUR }),
    ];
    const c = forA(items);
    expect(c.overdue).toEqual([
      { itemId: "vet", title: "Call the vet", nextDue: now - 2 * DAY },
      { itemId: "dishes", title: "Dishes", nextDue: now - HOUR },
    ]);
    expect(c.counts.overdue).toBe(2);
  });

  it("leaves out snoozed, archived and finished items", () => {
    const c = forA([
      chore("snoozed", "Snoozed", { lastDoneAt: now - 4 * DAY, snoozedUntil: now + HOUR }),
      chore("archived", "Archived", { lastDoneAt: now - 4 * DAY, archived: true }),
      task("finished", "Finished", { dueAt: now - DAY, lastDoneAt: now - 2 * HOUR }),
    ]);
    expect(c.overdue).toEqual([]);
  });
});

describe("due before the next Handoff", () => {
  it("lists items coming due between now and the next Handoff, soonest first", () => {
    const items = [
      task("later", "Renew passport", { dueAt: until + HOUR }), // after the next Handoff
      task("tomorrow", "Pay rent", { dueAt: now + 20 * HOUR }),
      chore("soon", "Baby bath", { lastDoneAt: now - 3 * DAY + 2 * HOUR }), // due in 2 hours
      task("undated", "Someday"),
    ];
    const c = forA(items);
    expect(c.dueBeforeNext).toEqual([
      { itemId: "soon", title: "Baby bath", nextDue: now + 2 * HOUR },
      { itemId: "tomorrow", title: "Pay rent", nextDue: now + 20 * HOUR },
    ]);
    expect(c.counts.dueBeforeNext).toBe(2);
  });

  it("leaves out an item snoozed past the next Handoff", () => {
    const c = forA([task("t", "Pay rent", { dueAt: now + HOUR, snoozedUntil: until + HOUR })]);
    expect(c.dueBeforeNext).toEqual([]);
  });
});
