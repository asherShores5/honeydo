import { beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(async () => {
  h.reset();
  await h.call(h.A, "me");
  await h.call(h.B, "me");
});

const task = (visibility: string) => ({ id: "t1", kind: "task", title: "shampoo", tags: [], visibility, archived: false });
const privateToA = () => `private:${h.A.userId}`;

describe("Comments on a shared item", () => {
  it("a Comment one Member leaves shows for both Members", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "used the last of the shampoo" });
    for (const m of [h.A, h.B]) {
      const cs = await h.call(m, "comments", { itemId: "t1" });
      expect(cs).toEqual([{ id: "c1", itemId: "t1", at: expect.any(Number), by: h.A.userId, text: "used the last of the shampoo" }]);
    }
  });

  it("a Comment on a shared item is published to both", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    const c = await h.call(h.B, "addComment", { itemId: "t1", id: "c1", text: "on it" });
    expect(h.visibilityDeliveredTo(c, h.A)).toBe(true);
    expect(h.visibilityDeliveredTo(c, h.B)).toBe(true);
    expect(c.comment).toMatchObject({ id: "c1", itemId: "t1", by: h.B.userId, text: "on it" });
  });
});

describe("Comments on a Private item never reach the partner", () => {
  it("the partner can't read them or add one", async () => {
    await h.call(h.A, "putItem", { input: task(privateToA()) });
    await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "ring size 6" });
    await expect(h.call(h.B, "comments", { itemId: "t1" })).rejects.toThrow("NotFound");
    await expect(h.call(h.B, "addComment", { itemId: "t1", id: "c2", text: "hi" })).rejects.toThrow("NotFound");
    expect(await h.call(h.A, "comments", { itemId: "t1" })).toHaveLength(1);
  });

  it("a new Comment is published to the owner only", async () => {
    await h.call(h.A, "putItem", { input: task(privateToA()) });
    const c = await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "ring size 6" });
    expect(h.visibilityDeliveredTo(c, h.A)).toBe(true);
    expect(h.visibilityDeliveredTo(c, h.B)).toBe(false);
  });

  it("a Comment on a Private item stays out of the partner's Activity", async () => {
    await h.call(h.A, "putItem", { input: task(privateToA()) });
    await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "ring size 6" });
    const { feed } = await h.call(h.B, "snapshot");
    expect(feed.filter((f: any) => f.type === "commented")).toEqual([]);
  });

  it("when a shared item goes Private, its earlier Comments stop reaching the partner", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    await h.call(h.B, "addComment", { itemId: "t1", id: "c1", text: "what size?" });
    await h.call(h.A, "putItem", { input: task(privateToA()) });
    await expect(h.call(h.B, "comments", { itemId: "t1" })).rejects.toThrow("NotFound");
    const { feed } = await h.call(h.B, "snapshot");
    expect(feed.filter((f: any) => f.itemId === "t1")).toEqual([]);
    // Shared again: they come back.
    await h.call(h.A, "putItem", { input: task("shared") });
    expect(await h.call(h.B, "comments", { itemId: "t1" })).toHaveLength(1);
  });
});

describe("A Comment keeps the Visibility its Item had when it was written (story 36)", () => {
  it("a Comment written while Private stays hidden from the partner when the item is shared again", async () => {
    await h.call(h.A, "putItem", { input: task(privateToA()) });
    await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "ring size 6" });
    await h.call(h.A, "putItem", { input: task("shared") });
    await h.call(h.A, "addComment", { itemId: "t1", id: "c2", text: "now shared" });
    expect((await h.call(h.B, "comments", { itemId: "t1" })).map((c: any) => c.id)).toEqual(["c2"]);
    expect((await h.call(h.A, "comments", { itemId: "t1" })).map((c: any) => c.id).sort()).toEqual(["c1", "c2"]);
    const { feed } = await h.call(h.B, "snapshot");
    expect(feed.filter((f: any) => f.type === "commented").map((f: any) => f.detail)).toEqual(["now shared"]);
  });

  it("a replay after the item is shared again still publishes to the owner only", async () => {
    await h.call(h.A, "putItem", { input: task(privateToA()) });
    await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "ring size 6" });
    await h.call(h.A, "putItem", { input: task("shared") });
    const again = await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "ring size 6" });
    expect(h.visibilityDeliveredTo(again, h.A)).toBe(true);
    expect(h.visibilityDeliveredTo(again, h.B)).toBe(false);
  });

  it("a replay after a shared item went Private publishes to the owner only", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "what size?" });
    await h.call(h.A, "putItem", { input: task(privateToA()) });
    const again = await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "what size?" });
    expect(h.visibilityDeliveredTo(again, h.A)).toBe(true);
    expect(h.visibilityDeliveredTo(again, h.B)).toBe(false);
  });
});

describe("Comments in Activity", () => {
  it("a Comment shows in both Members' Activity with its text", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    await h.call(h.B, "addComment", { itemId: "t1", id: "c1", text: "used the last of it" });
    for (const m of [h.A, h.B]) {
      const { feed } = await h.call(m, "snapshot");
      expect(feed.filter((f: any) => f.type === "commented")).toEqual([
        expect.objectContaining({ by: h.B.userId, itemId: "t1", title: "shampoo", detail: "used the last of it" }),
      ]);
    }
  });
});

describe("addComment input and replay", () => {
  it("sending the same Comment twice (retry after a lost response) stores and logs it once", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    const first = await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "done" });
    const again = await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "done" });
    expect(again).toEqual(first);
    expect(await h.call(h.A, "comments", { itemId: "t1" })).toHaveLength(1);
    const { feed } = await h.call(h.A, "snapshot");
    expect(feed.filter((f: any) => f.type === "commented")).toHaveLength(1);
  });

  it("rejects an empty or overlong Comment", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    await expect(h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "   " })).rejects.toThrow("ValidationError");
    await expect(h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "x".repeat(1001) })).rejects.toThrow("ValidationError");
  });

  it("Comments come back oldest first", async () => {
    vi.useFakeTimers();
    try {
      await h.call(h.A, "putItem", { input: task("shared") });
      vi.setSystemTime(2_000_000_000_000);
      await h.call(h.A, "addComment", { itemId: "t1", id: "zz", text: "first" });
      vi.setSystemTime(2_000_000_001_000);
      await h.call(h.B, "addComment", { itemId: "t1", id: "aa", text: "second" });
      expect((await h.call(h.A, "comments", { itemId: "t1" })).map((c: any) => c.text)).toEqual(["first", "second"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
