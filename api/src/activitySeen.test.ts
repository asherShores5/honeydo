import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => vi.useRealTimers());

const seen = (member: typeof h.A, activitySeenAt: unknown) =>
  h.call(member, "putProfile", { input: { activitySeenAt } });

describe("Activity last seen on the Profile", () => {
  it("is null until the Member first opens Activity", async () => {
    expect((await h.call(h.A, "me")).activitySeenAt).toBeNull();
  });

  it("saves and reads back, so it carries to the Member's other devices", async () => {
    await seen(h.A, 1_799_999_000_000);
    expect((await h.call(h.A, "me")).activitySeenAt).toBe(1_799_999_000_000);
  });

  it("is per Member", async () => {
    await seen(h.A, 1_799_999_000_000);
    expect((await h.call(h.B, "me")).activitySeenAt).toBeNull();
  });

  it("never moves back, so a stale device can't bring old events back as unread", async () => {
    await seen(h.A, 1_799_999_000_000);
    await seen(h.A, 1_799_000_000_000);
    expect((await h.call(h.A, "me")).activitySeenAt).toBe(1_799_999_000_000);
  });

  it("is capped at the server's now, so a fast device clock can't hide future events", async () => {
    await seen(h.A, 1_900_000_000_000);
    expect((await h.call(h.A, "me")).activitySeenAt).toBe(1_800_000_000_000);
  });

  it("saving other prefs leaves it alone", async () => {
    await seen(h.A, 1_799_999_000_000);
    await h.call(h.A, "putProfile", { input: { theme: "dark" } });
    expect((await h.call(h.A, "me")).activitySeenAt).toBe(1_799_999_000_000);
  });

  it.each([
    ["a string", "yesterday"],
    ["negative", -1],
    ["not finite", Infinity],
    ["not a number", NaN],
    ["an object", { at: 1 }],
  ])("rejects %s", async (_why, v) => {
    await expect(seen(h.A, v)).rejects.toThrow();
  });
});
