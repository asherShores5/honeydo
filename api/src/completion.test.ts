import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { status } from "@aubi/shared";
import { harness } from "./testing/harness";

const h = harness();
const DAY = 24 * 3600 * 1000;
const T0 = Date.UTC(2026, 9, 29, 12);

beforeEach(() => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const bath = {
  id: "bath", kind: "chore", title: "Bath", tags: [], visibility: "shared", archived: false,
  recurrence: JSON.stringify({ type: "interval", every: 7, unit: "days" }),
};

const feedTypes = async () => (await h.call(h.A, "snapshot")).feed.map((f: any) => f.type);
const history = async () => (await h.call(h.A, "completions", { itemId: "bath" })).map((c: any) => c.at);

describe("Completion edge cases", () => {
  it("a Completion replayed from the outbox makes one Completion and one Activity entry", async () => {
    await h.call(h.A, "putItem", { input: bath });
    const at = T0 - 3600_000;
    await h.call(h.A, "completeItem", { itemId: "bath", at });
    vi.advanceTimersByTime(5000); // reconnect later, outbox replays the same op
    await h.call(h.A, "completeItem", { itemId: "bath", at });

    expect(await history()).toEqual([at]);
    expect(await feedTypes()).toEqual(["completed", "created"]);
  });

  it("undo of a Completion that doesn't exist changes nothing and logs no Activity entry", async () => {
    await h.call(h.A, "putItem", { input: bath });
    const at = T0 - DAY;
    await h.call(h.A, "completeItem", { itemId: "bath", at });
    vi.advanceTimersByTime(1000);
    await h.call(h.A, "undoCompletion", { itemId: "bath", at });
    const before = (await h.call(h.A, "snapshot")).items[0];
    vi.advanceTimersByTime(1000);

    const c = await h.call(h.B, "undoCompletion", { itemId: "bath", at }); // already gone

    expect(c.item).toEqual(before);
    expect((await h.call(h.A, "snapshot")).items[0]).toEqual(before);
    expect(await feedTypes()).toEqual(["undone", "completed", "created"]);
  });

  it("a Completion backdated before last done is in History and Activity; lastDoneAt and Status are unchanged", async () => {
    await h.call(h.A, "putItem", { input: bath });
    const lastDone = T0 - DAY;
    await h.call(h.A, "completeItem", { itemId: "bath", at: lastDone });
    const before = (await h.call(h.A, "snapshot")).items[0];
    vi.advanceTimersByTime(1000);

    const backdated = T0 - 6 * DAY; // on its own this would make the weekly bath yellow
    const c = await h.call(h.B, "completeItem", { itemId: "bath", at: backdated });

    expect(await history()).toEqual([lastDone, backdated]);
    expect(await feedTypes()).toEqual(["completed", "completed", "created"]);
    const after = (await h.call(h.A, "snapshot")).items[0];
    expect(c.item.lastDoneAt).toBe(lastDone);
    expect(after.lastDoneAt).toBe(lastDone);
    expect(after.lastDoneBy).toBe(h.A.userId);
    expect(status(after, Date.now())).toBe("green");
    expect(status(after, Date.now())).toBe(status(before, Date.now()));
  });
});
