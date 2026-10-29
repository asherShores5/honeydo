import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

/** Seed one feed event per visibility, oldest first, one second apart. */
function seedFeed(visibilities: string[]) {
  visibilities.forEach((visibility, i) => {
    const at = 1_700_000_000_000 + i * 1000;
    const id = `${at}-e${i}`;
    h.db.seed({
      PK: "HH#aubi", SK: `FEED#${String(at).padStart(15, "0")}#${id}`, id, at, by: h.B.userId,
      type: "created", itemId: `item-${i}`, title: `event ${i}`, visibility,
    });
  });
}

const shared = (n: number) => Array<string>(n).fill("shared");
const partnerPrivate = (n: number) => Array<string>(n).fill(`private:${h.B.userId}`);

describe("Activity feed in the snapshot", () => {
  it("skips past the partner's private events: 150 events, 80 private to B, gives A all 70 visible", async () => {
    // Private events are the newest, so a filter-after-limit-100 would leave A only 20.
    seedFeed([...shared(70), ...partnerPrivate(80)]);
    const { feed } = await h.call(h.A, "snapshot");
    expect(feed).toHaveLength(70);
    expect(feed.every((f: any) => f.visibility === "shared")).toBe(true);
  });

  it("returns exactly the 100 newest visible events, newest first, when more than 100 are visible", async () => {
    // 300 events (indexes 0..299): every third one is B's private, so 200 are visible to A.
    seedFeed(Array.from({ length: 300 }, (_, i) => (i % 3 === 2 ? `private:${h.B.userId}` : "shared")));
    const { feed } = await h.call(h.A, "snapshot");
    // Newest 100 visible: indexes 299 down to 150, skipping i % 3 === 2.
    const expected = [];
    for (let i = 299; expected.length < 100; i--) if (i % 3 !== 2) expected.push(`event ${i}`);
    expect(expected.at(-1)).toBe("event 150");
    expect(feed.map((f: any) => f.title)).toEqual(expected);
  });

  it("the owner sees their own private events in the feed", async () => {
    seedFeed([...shared(30), ...partnerPrivate(120)]);
    const { feed } = await h.call(h.B, "snapshot");
    expect(feed).toHaveLength(100);
    expect(feed[0].title).toBe("event 149");
    expect(feed.at(-1).title).toBe("event 50");
  });
});
