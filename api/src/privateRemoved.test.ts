import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(async () => {
  h.reset();
  await h.call(h.A, "me");
  await h.call(h.B, "me");
});

const task = (visibility: string) => ({ id: "t1", kind: "task", title: "gift", tags: [], visibility, archived: false });

describe("making an item Private removes it live from the partner", () => {
  it("shared -> Private publishes a change the partner receives as a removal", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    const c = await h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`) });
    expect(h.deliveredTo(c, h.B)).toBe(true);
    expect(c.removedFor).toEqual([h.B.userId]);
  });

  it("the owner still gets the change as a normal update, not a removal", async () => {
    await h.call(h.A, "putItem", { input: task("shared") });
    const c = await h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`) });
    expect(h.deliveredTo(c, h.A)).toBe(true);
    expect(c.removedFor).not.toContain(h.A.userId);
    expect(c.item.visibility).toBe(`private:${h.A.userId}`);
  });

  it("Private -> shared reaches the partner as a normal change", async () => {
    await h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`) });
    const c = await h.call(h.A, "putItem", { input: task("shared") });
    expect(h.deliveredTo(c, h.B)).toBe(true);
    expect(c.removedFor).toEqual([]);
  });

  it("edits to an item that stays Private still never reach the partner", async () => {
    await h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`) });
    const c = await h.call(h.A, "putItem", { input: { ...task(`private:${h.A.userId}`), title: "ring" } });
    expect(h.deliveredTo(c, h.B)).toBe(false);
  });

  it("creating a Private item never reaches the partner", async () => {
    const c = await h.call(h.A, "putItem", { input: task(`private:${h.A.userId}`) });
    expect(h.deliveredTo(c, h.B)).toBe(false);
  });
});
