// Seam 2 for m5/04 (History & stats) and m5/02 (Calendar): every Completion in a period, not just
// the newest 50, so an hourly chore over 90 days is counted in full.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
const HOUR = 3600 * 1000;
const T0 = Date.UTC(2026, 9, 29, 12);

beforeEach(() => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const feed = {
  id: "feed", kind: "chore", title: "Feed baby", tags: [], visibility: "shared", archived: false,
  recurrence: JSON.stringify({ type: "interval", every: 3, unit: "hours" }),
};

async function doneEveryHour(hours: number) {
  await h.call(h.A, "putItem", { input: feed });
  for (let n = hours; n >= 1; n--) await h.call(h.A, "completeItem", { itemId: "feed", at: T0 - n * HOUR });
}

describe("completions since a time", () => {
  it("returns every Completion at or after `since`, newest first, past the default 50", async () => {
    await doneEveryHour(300);
    const list = await h.call(h.A, "completions", { itemId: "feed", since: T0 - 200 * HOUR });
    expect(list).toHaveLength(200);
    expect(list[0].at).toBe(T0 - HOUR);
    expect(list.at(-1).at).toBe(T0 - 200 * HOUR);
  });

  it("without `since` still returns the newest 50", async () => {
    await doneEveryHour(80);
    expect(await h.call(h.A, "completions", { itemId: "feed" })).toHaveLength(50);
  });

  it("still refuses an item the caller can't see", async () => {
    await h.call(h.A, "putItem", { input: { ...feed, visibility: `private:${h.A.userId}` } });
    await expect(h.call(h.B, "completions", { itemId: "feed", since: 0 })).rejects.toThrow();
  });
});
