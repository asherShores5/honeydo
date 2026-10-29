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

const diapers = { id: "diapers", kind: "task", title: "Buy diapers", tags: [], visibility: "shared", archived: false };

const item = async () => (await h.call(h.A, "snapshot")).items[0];
const feedTypes = async () => (await h.call(h.A, "snapshot")).feed.map((f: any) => f.type);
const history = async () => (await h.call(h.A, "completions", { itemId: "diapers" })).map((c: any) => c.at);

describe("Task Done", () => {
  it("Done on a Task finishes and Archives it, and records a Completion", async () => {
    await h.call(h.A, "putItem", { input: diapers });
    vi.advanceTimersByTime(1000);

    const c = await h.call(h.B, "completeItem", { itemId: "diapers" });

    expect(c.item.archived).toBe(true);
    const after = await item();
    expect(after.archived).toBe(true);
    expect(status(after, Date.now())).toBe("done");
    expect(await history()).toEqual([T0 + 1000]);
    expect(await feedTypes()).toEqual(["completed", "created"]);
  });

  it("undoing the Task's only Completion un-archives it and it comes back to its list", async () => {
    await h.call(h.A, "putItem", { input: diapers });
    vi.advanceTimersByTime(1000);
    const done = await h.call(h.A, "completeItem", { itemId: "diapers" });
    vi.advanceTimersByTime(1000);

    const c = await h.call(h.A, "undoCompletion", { itemId: "diapers", at: done.item.lastDoneAt });

    expect(c.item.archived).toBe(false);
    const after = await item();
    expect(after.archived).toBe(false);
    expect(after.lastDoneAt).toBeUndefined();
    expect(status(after, Date.now())).toBe("green");
    expect(await history()).toEqual([]);
  });

  it("a replayed Done on a finished Task changes nothing and logs no second Activity entry", async () => {
    await h.call(h.A, "putItem", { input: diapers });
    const at = T0 - 3600_000;
    await h.call(h.A, "completeItem", { itemId: "diapers", at });
    const before = await item();
    vi.advanceTimersByTime(5000);

    const c = await h.call(h.A, "completeItem", { itemId: "diapers", at });

    expect(c.item).toEqual(before);
    expect(await item()).toEqual(before);
    expect(await history()).toEqual([at]);
    expect(await feedTypes()).toEqual(["completed", "created"]);
  });

  it("undoing one of two Completions leaves the Task finished and Archived", async () => {
    await h.call(h.A, "putItem", { input: diapers });
    await h.call(h.A, "completeItem", { itemId: "diapers", at: T0 - DAY });
    await h.call(h.B, "completeItem", { itemId: "diapers", at: T0 - 3600_000 });

    const c = await h.call(h.A, "undoCompletion", { itemId: "diapers", at: T0 - 3600_000 });

    expect(c.item.archived).toBe(true);
    expect(c.item.lastDoneAt).toBe(T0 - DAY);
    expect(status(c.item, Date.now())).toBe("done");
  });

  it("Done on a Chore Resets it and leaves it un-Archived; undo leaves it un-Archived too", async () => {
    const bath = { id: "bath", kind: "chore", title: "Bath", tags: [], visibility: "shared", archived: false,
      recurrence: JSON.stringify({ type: "interval", every: 3, unit: "days" }) };
    await h.call(h.A, "putItem", { input: bath });

    const c = await h.call(h.A, "completeItem", { itemId: "bath", at: T0 });
    expect(c.item.archived).toBe(false);
    expect(c.item.lastDoneAt).toBe(T0);
    expect(status(c.item, Date.now())).toBe("green");

    const u = await h.call(h.A, "undoCompletion", { itemId: "bath", at: T0 });
    expect(u.item.archived).toBe(false);
    expect(status(u.item, Date.now())).toBe("red"); // never done: due now
  });
});
