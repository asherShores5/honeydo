import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
const T0 = Date.UTC(2026, 9, 29, 12);

beforeEach(() => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const diapers = { id: "diapers", kind: "task", title: "Buy diapers", tags: [], visibility: "shared", archived: false };

const item = async () => (await h.call(h.A, "snapshot")).items[0];
const feedTypes = async () => (await h.call(h.A, "snapshot")).feed.map((f: any) => f.type);
const history = async () => (await h.call(h.A, "completions", { itemId: "diapers" })).map((c: any) => c.at);

/** The Lambda dies on its next item update (after any earlier writes in the same call landed). */
function crashOnNextItemUpdate() {
  const send = h.db.send.bind(h.db);
  vi.spyOn(h.db, "send").mockImplementation(async (cmd: unknown) => {
    if (cmd instanceof UpdateCommand) {
      vi.mocked(h.db.send).mockRestore();
      throw new Error("Lambda timed out");
    }
    return send(cmd);
  });
}

describe("Completion writes survive a crash between steps", () => {
  it("Done that crashes before the item update heals on replay: one Completion, one Activity entry, Task Archived", async () => {
    await h.call(h.A, "putItem", { input: diapers });
    vi.advanceTimersByTime(1000);
    const at = Date.now();

    crashOnNextItemUpdate();
    await expect(h.call(h.A, "completeItem", { itemId: "diapers", at })).rejects.toThrow("InternalError");
    vi.advanceTimersByTime(5000); // outbox replays the same op
    const c = await h.call(h.A, "completeItem", { itemId: "diapers", at });

    expect(await history()).toEqual([at]);
    expect(await feedTypes()).toEqual(["completed", "created"]);
    expect(c.item).toMatchObject({ lastDoneAt: at, archived: true });
    expect(await item()).toMatchObject({ lastDoneAt: at, lastDoneBy: h.A.userId, archived: true });
  });

  it("undo that crashes before the item recompute heals on replay: one undone entry, Task back off the Archive", async () => {
    await h.call(h.A, "putItem", { input: diapers });
    vi.advanceTimersByTime(1000);
    const at = Date.now();
    await h.call(h.A, "completeItem", { itemId: "diapers", at });
    vi.advanceTimersByTime(1000);

    crashOnNextItemUpdate();
    await expect(h.call(h.A, "undoCompletion", { itemId: "diapers", at })).rejects.toThrow("InternalError");
    vi.advanceTimersByTime(5000);
    const c = await h.call(h.A, "undoCompletion", { itemId: "diapers", at });

    expect(await history()).toEqual([]);
    expect(await feedTypes()).toEqual(["undone", "completed", "created"]);
    expect(c.item.archived).toBe(false);
    const after = await item();
    expect(after.archived).toBe(false);
    expect(after.lastDoneAt).toBeUndefined();
  });

  it("a replayed undo on an already-healed item changes nothing", async () => {
    await h.call(h.A, "putItem", { input: diapers });
    vi.advanceTimersByTime(1000);
    const at = Date.now();
    await h.call(h.A, "completeItem", { itemId: "diapers", at });
    vi.advanceTimersByTime(1000);
    await h.call(h.A, "undoCompletion", { itemId: "diapers", at });
    const before = await item();
    vi.advanceTimersByTime(1000);

    await h.call(h.A, "undoCompletion", { itemId: "diapers", at });

    expect(await item()).toEqual(before);
    expect(await feedTypes()).toEqual(["undone", "completed", "created"]);
  });
});
