import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
const NOW = 1_800_000_000_000;

beforeEach(() => {
  h.reset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const post = (args: Record<string, unknown>, member = h.A) => h.call(member, "postNote", { id: "n1", text: "Out of diapers", ...args });

describe("postNote", () => {
  it("puts a shared Note on both Members' Fridge and fans it out to the partner", async () => {
    const note = await post({});
    expect(note).toMatchObject({ id: "n1", text: "Out of diapers", by: h.A.userId, at: NOW, pinned: false, visibility: "shared" });
    expect(h.visibilityDeliveredTo(note, h.B)).toBe(true);
    expect(h.visibilityDeliveredTo(note, h.A)).toBe(true);
    const { notes } = await h.call(h.B, "snapshot");
    expect(notes).toEqual([note]);
  });

  it("logs one 'posted' Activity entry, even when the offline outbox replays the post", async () => {
    await post({});
    vi.setSystemTime(NOW + 5000);
    const replay = await post({});
    expect(replay.at).toBe(NOW);
    const { feed } = await h.call(h.B, "snapshot");
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ type: "posted", by: h.A.userId, title: "Out of diapers", visibility: "shared" });
  });

  it("can start pinned and with an expiry", async () => {
    const note = await post({ pinned: true, expiresAt: NOW + 3600_000 });
    expect(note).toMatchObject({ pinned: true, expiresAt: NOW + 3600_000 });
  });

  it("trims the text and rejects empty, too-long or badly shaped input", async () => {
    expect((await post({ text: "  milk  " })).text).toBe("milk");
    await expect(post({ id: "n2", text: "   " })).rejects.toThrow(/ValidationError/);
    await expect(post({ id: "n3", text: "x".repeat(501) })).rejects.toThrow(/ValidationError/);
    await expect(post({ id: "bad id!" })).rejects.toThrow(/ValidationError/);
    await expect(post({ id: "n4", expiresAt: Number.NaN })).rejects.toThrow(/ValidationError/);
  });

  it("an ID already used by the partner's Note doesn't overwrite it", async () => {
    await post({ text: "first" });
    const again = await post({ text: "second" }, h.B);
    expect(again).toMatchObject({ text: "first", by: h.A.userId });
  });
});

const fridgeIds = async (member = h.B) => (await h.call(member, "snapshot")).notes.map((n: any) => n.id);

describe("pinNote", () => {
  it("the partner can pin and unpin a Note, and the Fridge puts pinned Notes first", async () => {
    await post({ id: "older", text: "older" });
    vi.setSystemTime(NOW + 1000);
    await post({ id: "newer", text: "newer" });
    const pinned = await h.call(h.B, "pinNote", { id: "older", pinned: true });
    expect(pinned).toMatchObject({ id: "older", pinned: true, text: "older", by: h.A.userId, at: NOW, updatedAt: NOW + 1000 });
    expect(h.visibilityDeliveredTo(pinned, h.A)).toBe(true);
    expect(await fridgeIds(h.A)).toEqual(["older", "newer"]);
    await h.call(h.A, "pinNote", { id: "older", pinned: false });
    expect(await fridgeIds(h.A)).toEqual(["newer", "older"]);
  });

  it("pinning a Note that doesn't exist is NotFound and creates nothing", async () => {
    await expect(h.call(h.A, "pinNote", { id: "nope", pinned: true })).rejects.toThrow(/NotFound/);
    expect(h.db.dump()).toEqual([]);
  });

  it("logs no Activity entry", async () => {
    await post({});
    await h.call(h.B, "pinNote", { id: "n1", pinned: true });
    expect((await h.call(h.A, "snapshot")).feed).toHaveLength(1);
  });
});

describe("Note expiry", () => {
  it("an expired Note drops off the Fridge in the snapshot", async () => {
    await post({ id: "soon", expiresAt: NOW + 60_000 });
    vi.setSystemTime(NOW + 1000);
    await post({ id: "keep" });
    expect(await fridgeIds()).toEqual(["keep", "soon"]);
    vi.setSystemTime(NOW + 60_000);
    expect(await fridgeIds()).toEqual(["keep"]);
  });

  it("setNoteExpiry sets, moves and clears the expiry", async () => {
    await post({});
    expect(await h.call(h.B, "setNoteExpiry", { id: "n1", expiresAt: NOW + 5000 })).toMatchObject({ expiresAt: NOW + 5000 });
    const cleared = await h.call(h.A, "setNoteExpiry", { id: "n1", expiresAt: null });
    expect(cleared.expiresAt).toBeUndefined();
    vi.setSystemTime(NOW + 10_000);
    expect(await fridgeIds()).toEqual(["n1"]);
  });

  it("an expiry in the past takes the Note off the Fridge at once", async () => {
    await post({});
    await h.call(h.A, "setNoteExpiry", { id: "n1", expiresAt: NOW - 1 });
    expect(await fridgeIds()).toEqual([]);
  });

  it("an expiring Note gets a DynamoDB TTL a week after it expires; clearing the expiry removes it", async () => {
    await post({ expiresAt: NOW + 1000 });
    const ttlOf = () => h.db.dump().find((r) => r.SK === "NOTE#n1")!.ttl;
    expect(ttlOf()).toBe((NOW + 1000) / 1000 + 7 * 24 * 3600);
    await h.call(h.A, "setNoteExpiry", { id: "n1", expiresAt: null });
    expect(ttlOf()).toBeUndefined();
  });

  it("rejects a bad expiry, and an unknown Note is NotFound", async () => {
    await post({});
    await expect(h.call(h.A, "setNoteExpiry", { id: "n1", expiresAt: -5 })).rejects.toThrow(/ValidationError/);
    await expect(h.call(h.A, "setNoteExpiry", { id: "n9", expiresAt: NOW })).rejects.toThrow(/NotFound/);
  });
});
