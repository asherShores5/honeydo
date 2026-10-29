import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const chore = (id: string, visibility: string) => ({
  id, kind: "chore", title: id, tags: [], visibility, archived: false,
  recurrence: JSON.stringify({ type: "interval", every: 3, unit: "days" }),
});

describe("private item isolation", () => {
  it("a Private item shows in its owner's snapshot only", async () => {
    await h.call(h.A, "me");
    await h.call(h.B, "me");
    await h.call(h.A, "putItem", { input: chore("secret", `private:${h.A.userId}`) });
    await h.call(h.A, "putItem", { input: chore("dishes", "shared") });

    const ids = (s: any) => s.items.map((i: any) => i.id).sort();
    expect(ids(await h.call(h.A, "snapshot"))).toEqual(["dishes", "secret"]);
    expect(ids(await h.call(h.B, "snapshot"))).toEqual(["dishes"]);
  });

  it("the store starts empty after reset", async () => {
    expect((await h.call(h.A, "snapshot")).items).toEqual([]);
  });

  it("a Private item's change is delivered to its owner's subscription only", async () => {
    const c = await h.call(h.A, "putItem", { input: chore("secret", `private:${h.A.userId}`) });
    expect(h.deliveredTo(c, h.A)).toBe(true);
    expect(h.deliveredTo(c, h.B)).toBe(false);
  });

  it("rejects callers outside the Household", async () => {
    await expect(h.call({ userId: "x", username: "stranger" }, "snapshot")).rejects.toThrow("Forbidden");
  });
});
