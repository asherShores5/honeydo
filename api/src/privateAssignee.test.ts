import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(async () => {
  h.reset();
  await h.call(h.A, "me");
  await h.call(h.B, "me");
});

const task = (visibility: string, assigneeId?: string) => ({
  id: "t1", kind: "task", title: "gift", tags: [], visibility, archived: false, assigneeId,
});

describe("a Private item's Assignee can only be its owner", () => {
  it("rejects a Private item assigned to the partner", async () => {
    await expect(
      h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`, h.B.userId) }),
    ).rejects.toThrow("ValidationError: a private item can only be assigned to you");
  });

  it("accepts a Private item with no Assignee", async () => {
    const c = await h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`) });
    expect(c.item.assigneeId).toBeUndefined();
  });

  it("accepts a Private item assigned to its owner", async () => {
    const c = await h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`, h.A.userId) });
    expect(c.item.assigneeId).toBe(h.A.userId);
  });

  it("rejects making a shared item assigned to the partner Private, and leaves it shared", async () => {
    await h.call(h.A, "putItem", { input: task("shared", h.B.userId) });
    await expect(
      h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`, h.B.userId) }),
    ).rejects.toThrow("ValidationError");
    const snap = await h.call(h.B, "snapshot");
    expect(snap.items.map((i: any) => [i.id, i.visibility, i.assigneeId])).toEqual([["t1", "shared", h.B.userId]]);
  });
});
