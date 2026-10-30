// Only an Item's creator may move a shared Item to Private: otherwise the partner could make
// someone else's Item vanish from their phone.
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(async () => {
  h.reset();
  await h.call(h.A, "me");
  await h.call(h.B, "me");
});

const task = (visibility: string, over: Record<string, unknown> = {}) => ({
  id: "t1", kind: "task", title: "Fix the gate", tags: [], visibility, archived: false, ...over,
});

describe("moving a shared Item to Private", () => {
  it("the partner can't make the creator's shared Item Private to themselves", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    await expect(h.call(h.B, "putItem", { input: task(`private:${h.B.userId}`) })).rejects.toThrow(/Forbidden/);
    const [item] = (await h.call(h.A, "snapshot")).items;
    expect(item).toMatchObject({ id: "t1", visibility: "shared", version: 1 });
  });

  it("the creator can still make their own shared Item Private", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    const c = await h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`) });
    expect(c.visibility).toBe(`private:${h.A.userId}`);
  });

  it("the partner can still edit the creator's shared Item if it stays shared", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    const c = await h.call(h.B, "putItem", { input: task("shared", { title: "Fix the side gate" }) });
    expect(c.item.title).toBe("Fix the side gate");
  });

  it("creating a new Private Item is still allowed", async () => {
    const c = await h.call(h.B, "putItem", { input: task(`private:${h.B.userId}`) });
    expect(c.visibility).toBe(`private:${h.B.userId}`);
  });

  it("editing your own Private Item is still allowed", async () => {
    await h.call(h.B, "putItem", { input: task(`private:${h.B.userId}`) });
    const c = await h.call(h.B, "putItem", { input: task(`private:${h.B.userId}`, { title: "Gift" }) });
    expect(c.item.title).toBe("Gift");
  });
});
