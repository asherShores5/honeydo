import { describe, expect, it } from "vitest";
import { HOUR, planHandoffs, readAlertPrefs, type Completion, type Item } from "@aubi/shared";
import { cardDismissed, dismissCard, handoffCard, handoffWindow, itemsDoneSince, withPending, type CardProfile } from "./handoffCard";

const MON_8PM = Date.UTC(2026, 9, 6, 3, 0); // Mon 2026-10-05 20:00 Pacific (PDT)
const SUN_8PM = Date.UTC(2026, 9, 5, 3, 0);
const TUE_8PM = Date.UTC(2026, 9, 7, 3, 0);

describe("handoffWindow (which Handoff the card shows)", () => {
  it("after today's Handoff time, shows today's: done since yesterday's, due before tomorrow's", () => {
    expect(handoffWindow("20:00", MON_8PM + 2 * HOUR)).toEqual({ at: MON_8PM, since: SUN_8PM, until: TUE_8PM });
  });

  it("before today's Handoff time, still shows yesterday's", () => {
    expect(handoffWindow("20:00", MON_8PM - HOUR)).toEqual({ at: SUN_8PM, since: Date.UTC(2026, 9, 4, 3, 0), until: MON_8PM });
  });

  it("at the Handoff time exactly, it's the new one", () => {
    expect(handoffWindow("20:00", MON_8PM).at).toBe(MON_8PM);
  });

  it("follows the wall clock across the DST change (Sun 2026-11-01)", () => {
    const sat = Date.UTC(2026, 10, 1, 3, 0); // Sat 20:00 PDT
    const sun = Date.UTC(2026, 10, 2, 4, 0); // Sun 20:00 PST, 25 hours later
    expect(handoffWindow("20:00", sun + HOUR)).toEqual({ at: sun, since: sat, until: Date.UTC(2026, 10, 3, 4, 0) });
  });
});

const ASHER = "sub-a";
const AUBYN = "sub-b";
const profiles: Record<string, CardProfile> = {
  [ASHER]: { userId: ASHER, username: "asher", displayName: "Asher", alertPrefs: { handoffAt: "20:00" } },
  [AUBYN]: { userId: AUBYN, username: "aubyn" }, // no display name: the push falls back to the username
};
const base = { tags: [] as string[], visibility: "shared" as const, createdBy: ASHER, createdAt: 0, updatedAt: 0, version: 1, archived: false };
const daily = { type: "interval", every: 1, unit: "days" } as const;
const items = [
  { ...base, id: "trash", title: "Trash", kind: "chore", recurrence: daily, lastDoneAt: MON_8PM - 3 * HOUR, lastDoneBy: AUBYN },
  { ...base, id: "dishes", title: "Dishes", kind: "chore", recurrence: daily, lastDoneAt: SUN_8PM - 30 * HOUR },
  { ...base, id: "bath", title: "Baby bath", kind: "chore", recurrence: { type: "interval", every: 2, unit: "days" }, lastDoneAt: SUN_8PM - 2 * HOUR },
  { ...base, id: "rx", title: "Pick up prescription", kind: "task", dueAt: MON_8PM + 5 * HOUR },
  { ...base, id: "gift", title: "Gift", kind: "task", archived: true, lastDoneAt: MON_8PM - HOUR, lastDoneBy: ASHER },
  { ...base, id: "secret", title: "Aubyn's secret", kind: "chore", recurrence: daily, visibility: `private:${AUBYN}`, lastDoneAt: MON_8PM - HOUR, lastDoneBy: AUBYN },
] as Item[];
const completions: Completion[] = [
  { itemId: "trash", at: SUN_8PM - HOUR, by: ASHER }, // before the window
  { itemId: "trash", at: MON_8PM - 3 * HOUR, by: AUBYN },
  { itemId: "gift", at: MON_8PM - HOUR, by: ASHER },
  { itemId: "secret", at: MON_8PM - HOUR, by: AUBYN },
];
// What Asher's snapshot holds: the server never sends him Aubyn's Private item.
const asherItems = items.filter((i) => i.visibility === "shared");

describe("handoffCard (the card says what the push says)", () => {
  it("at the Handoff time, matches the Notifier's Handoff for that moment", () => {
    const members = Object.values(profiles).map((p) => ({ userId: p.userId, prefs: readAlertPrefs(p.alertPrefs), name: p.displayName ?? p.username }));
    const [pushed] = planHandoffs(items, completions, members, [{ userId: ASHER, lastHandoffAt: SUN_8PM }], MON_8PM);
    const card = handoffCard({ userId: ASHER, items: asherItems, completions, profiles, now: MON_8PM });
    expect(card).toEqual(pushed.content);
    expect(card.lines).toEqual([
      "Done: Trash (aubyn), Gift (you)",
      "Overdue: Dishes",
      "Due before next Handoff: Pick up prescription, Trash, Baby bath", // Tue 1am, 5pm, 6pm
    ]);
  });

  it("later that evening, counts what got done after the push too", () => {
    const later = [...completions, { itemId: "dishes", at: MON_8PM + HOUR, by: ASHER }];
    const dishes = { ...items[1], lastDoneAt: MON_8PM + HOUR, lastDoneBy: ASHER };
    const card = handoffCard({ userId: ASHER, items: asherItems.map((i) => (i.id === "dishes" ? dishes : i)), completions: later, profiles, now: MON_8PM + 2 * HOUR });
    expect(card.lines).toEqual([
      "Done: Trash (aubyn), Gift (you), Dishes (you)",
      "Due before next Handoff: Pick up prescription, Trash, Baby bath",
    ]);
  });
});

describe("dismissing the card", () => {
  const memoryStorage = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("hides it until the next Handoff, then it's back", () => {
    const store = memoryStorage();
    expect(cardDismissed(store, ASHER, "20:00", MON_8PM + HOUR)).toBe(false);
    dismissCard(store, ASHER, "20:00", MON_8PM + HOUR);
    expect(cardDismissed(store, ASHER, "20:00", MON_8PM + 5 * HOUR)).toBe(true); // after midnight, same Handoff
    expect(cardDismissed(store, ASHER, "20:00", TUE_8PM)).toBe(false);
  });

  it("is per Member: a shared device doesn't hide the partner's card", () => {
    const store = memoryStorage();
    dismissCard(store, ASHER, "20:00", MON_8PM + HOUR);
    expect(cardDismissed(store, AUBYN, "20:00", MON_8PM + HOUR)).toBe(false);
  });

  it("survives junk in storage", () => {
    const store = memoryStorage();
    store.setItem("aubi.handoffDismissed.v1", "{not json");
    expect(cardDismissed(store, ASHER, "20:00", MON_8PM + HOUR)).toBe(false);
    dismissCard(store, ASHER, "20:00", MON_8PM + HOUR);
    expect(cardDismissed(store, ASHER, "20:00", MON_8PM + HOUR)).toBe(true);
  });
});

describe("withPending (offline Done shows on the card before it syncs)", () => {
  it("adds queued Dones by me and drops queued Undos", () => {
    const fetched: Completion[] = [{ itemId: "trash", at: 10, by: AUBYN }, { itemId: "gift", at: 20, by: ASHER }];
    const out = withPending(fetched, [
      { id: "1", type: "completeItem", itemId: "dishes", at: 30 },
      { id: "2", type: "undoCompletion", itemId: "gift", at: 20 },
      { id: "3", type: "completeItem", itemId: "trash", at: 10 }, // replay of one already on the server
      { id: "4", type: "putItem", input: {} as never, changed: [] },
    ], ASHER);
    expect(out).toEqual([{ itemId: "trash", at: 10, by: AUBYN }, { itemId: "dishes", at: 30, by: ASHER }]);
  });
});

describe("itemsDoneSince (whose Completions the card needs)", () => {
  it("is the items last done inside the window: lastDoneAt is the newest Completion", () => {
    expect(itemsDoneSince(asherItems, SUN_8PM).sort()).toEqual(["gift", "trash"]);
  });
});
