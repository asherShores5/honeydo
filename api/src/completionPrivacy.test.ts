// SPEC §4.5: a Completion logged while its Item was Private never reaches the partner, even after
// the Item is shared again. Completions carry their Item's Visibility when written (like Comments
// and Activity); rows written before the stamp count as shared.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUR } from "@aubi/shared";
import { harness } from "./testing/harness";

const h = harness();
const T0 = Date.UTC(2026, 9, 29, 12);

beforeEach(async () => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  await h.call(h.A, "me");
  await h.call(h.B, "me");
});
afterEach(() => vi.useRealTimers());

const bath = (visibility: string) => ({
  id: "bath", kind: "chore", title: "Bath", tags: [], visibility, archived: false,
  recurrence: JSON.stringify({ type: "interval", every: 7, unit: "days" }),
});
const PRIVATE_A = "private:sub-a";

const history = async (who: typeof h.A, args: Record<string, unknown> = {}) =>
  (await h.call(who, "completions", { itemId: "bath", ...args })).map((c: any) => c.at);

/** A does the chore once while Private (with a note), then shares it and does it again. */
async function privateThenShared() {
  await h.call(h.A, "putItem", { input: bath(PRIVATE_A) });
  await h.call(h.A, "completeItem", { itemId: "bath", at: T0 - 2 * HOUR, note: "secret" });
  await h.call(h.A, "putItem", { input: bath("shared") });
  await h.call(h.A, "completeItem", { itemId: "bath", at: T0 - HOUR });
}

describe("Completions logged while Private", () => {
  it("are stamped with the Item's Visibility", async () => {
    await privateThenShared();
    const rows = h.db.dump().filter((r) => String(r.SK).startsWith("DONE#"));
    expect(rows.map((r) => [r.at, r.visibility])).toEqual([[T0 - 2 * HOUR, PRIVATE_A], [T0 - HOUR, "shared"]]);
  });

  it("stay out of the partner's completions read after the Item is shared", async () => {
    await privateThenShared();
    expect(await history(h.B)).toEqual([T0 - HOUR]);
    expect(await history(h.B, { since: 0 })).toEqual([T0 - HOUR]);
    expect(JSON.stringify(await h.call(h.B, "completions", { itemId: "bath" }))).not.toContain("secret");
  });

  it("still show for the Member who logged them", async () => {
    await privateThenShared();
    expect(await history(h.A)).toEqual([T0 - HOUR, T0 - 2 * HOUR]);
    expect(await history(h.A, { since: 0 })).toEqual([T0 - HOUR, T0 - 2 * HOUR]);
  });

  it("don't use up the partner's limit: the newest N visible ones come back", async () => {
    await h.call(h.A, "putItem", { input: bath("shared") });
    await h.call(h.A, "completeItem", { itemId: "bath", at: T0 - 5 * HOUR });
    await h.call(h.A, "putItem", { input: bath(PRIVATE_A) });
    for (const n of [4, 3, 2]) await h.call(h.A, "completeItem", { itemId: "bath", at: T0 - n * HOUR });
    await h.call(h.A, "putItem", { input: bath("shared") });
    expect(await history(h.B, { limit: 1 })).toEqual([T0 - 5 * HOUR]);
  });

  it("the read output carries no visibility stamp", async () => {
    await privateThenShared();
    const [c] = await h.call(h.A, "completions", { itemId: "bath", limit: 1 });
    expect(c).not.toHaveProperty("visibility");
  });

  it("rows written before stamping count as shared", async () => {
    await h.call(h.A, "putItem", { input: bath("shared") });
    h.db.seed({ PK: "HH#aubi", SK: `DONE#bath#${String(T0 - HOUR).padStart(15, "0")}`, itemId: "bath", at: T0 - HOUR, by: h.A.userId });
    expect(await history(h.B)).toEqual([T0 - HOUR]);
  });
});

describe("undoing a Completion the caller can't see", () => {
  it("the partner can't delete one logged while the Item was Private; nothing is logged", async () => {
    await privateThenShared();
    const before = (await h.call(h.A, "snapshot")).feed.length;
    await h.call(h.B, "undoCompletion", { itemId: "bath", at: T0 - 2 * HOUR });
    expect(await history(h.A)).toEqual([T0 - HOUR, T0 - 2 * HOUR]);
    expect((await h.call(h.A, "snapshot")).feed.length).toBe(before);
  });

  it("the Member who logged it can still undo it", async () => {
    await privateThenShared();
    await h.call(h.A, "undoCompletion", { itemId: "bath", at: T0 - 2 * HOUR });
    expect(await history(h.A)).toEqual([T0 - HOUR]);
  });

  it("the partner's undo of a shared one still works, and lastDoneAt falls back to the true latest", async () => {
    await privateThenShared();
    await h.call(h.B, "undoCompletion", { itemId: "bath", at: T0 - HOUR });
    expect(await history(h.A)).toEqual([T0 - 2 * HOUR]);
    const [item] = (await h.call(h.A, "snapshot")).items;
    expect(item.lastDoneAt).toBe(T0 - 2 * HOUR);
  });
});
