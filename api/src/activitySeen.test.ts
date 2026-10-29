import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => vi.useRealTimers());

const seen = (member: typeof h.A, at: unknown) => h.call(member, "markActivitySeen", { at });

describe("Activity last seen (markActivitySeen)", () => {
  it("is null until the Member first opens Activity", async () => {
    expect((await h.call(h.A, "me")).activitySeenAt).toBeNull();
  });

  it("saves and reads back on `me`, so it carries to the Member's other devices", async () => {
    expect(await seen(h.A, 1_799_999_000_000)).toBe(1_799_999_000_000);
    expect((await h.call(h.A, "me")).activitySeenAt).toBe(1_799_999_000_000);
  });

  it("is per Member", async () => {
    await seen(h.A, 1_799_999_000_000);
    expect((await h.call(h.B, "me")).activitySeenAt).toBeNull();
  });

  it("never moves back, so a stale device can't bring old events back as unread", async () => {
    await seen(h.A, 1_799_999_000_000);
    expect(await seen(h.A, 1_799_000_000_000)).toBe(1_799_999_000_000);
    expect((await h.call(h.A, "me")).activitySeenAt).toBe(1_799_999_000_000);
  });

  it("is capped at the server's now, so a fast device clock can't hide future events", async () => {
    expect(await seen(h.A, 1_900_000_000_000)).toBe(1_800_000_000_000);
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
    await expect(seen(h.A, v)).rejects.toThrow("ValidationError");
  });
});

describe("Activity last seen never reaches the partner", () => {
  it("putProfile, which onProfileChange fans out to both, doesn't carry it", async () => {
    await seen(h.A, 1_799_999_000_000);
    const fanned = await h.call(h.A, "putProfile", { input: { theme: "dark" } });
    expect(fanned.activitySeenAt ?? null).toBeNull();
  });

  it("the partner's snapshot Profiles don't carry it", async () => {
    await seen(h.A, 1_799_999_000_000);
    const { profiles } = await h.call(h.B, "snapshot");
    const a = profiles.find((p: any) => p.userId === h.A.userId);
    expect(a.activitySeenAt ?? null).toBeNull();
  });

  it("putProfile no longer sets it", async () => {
    await h.call(h.A, "putProfile", { input: { activitySeenAt: 1_799_999_000_000 } });
    expect((await h.call(h.A, "me")).activitySeenAt).toBeNull();
  });
});
