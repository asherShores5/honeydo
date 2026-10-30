// Seam 2 for m5/05: Saved views live on each Member's own Profile and are validated by the server.
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const view = (over: Record<string, unknown> = {}) => ({
  id: "nursery", name: "Nursery evenings", tags: ["locale-nursery"], who: "anyone",
  sort: "urgency", layout: "list", pinned: true, ...over,
});
const save = (member: typeof h.A, savedViews: unknown) => h.call(member, "putProfile", { input: { savedViews } });

describe("Saved views", () => {
  it("are saved on the Member's Profile and read back on `me`", async () => {
    await save(h.A, [view(), view({ id: "board", name: "By room", layout: "board", boardGroup: "Locale", pinned: false })]);
    const me = await h.call(h.A, "me");
    expect(me.savedViews.map((v: { id: string; pinned: boolean }) => [v.id, v.pinned])).toEqual([["nursery", true], ["board", false]]);
  });

  it("are per Member: my partner's don't show on my Profile", async () => {
    await save(h.A, [view()]);
    expect((await h.call(h.B, "me")).savedViews).toBeNull();
  });

  it.each([
    ["an unknown Who", [view({ who: "everyone" })]],
    ["an unknown layout", [view({ layout: "kanban" })]],
    ["an unknown sort", [view({ sort: "random" })]],
    ["a blank name", [view({ name: "  " })]],
    ["a long name", [view({ name: "x".repeat(41) })]],
    ["a bad id", [view({ id: "has space" })]],
    ["duplicate ids", [view(), view({ name: "Again" })]],
    ["an unknown field", [view({ color: "red" })]],
    ["a board without a Tag group", [view({ layout: "board" })]],
    ["too many views", Array.from({ length: 21 }, (_, n) => view({ id: `v${n}` }))],
    ["not a list", view()],
  ])("rejects %s", async (_what, savedViews) => {
    await expect(save(h.A, savedViews)).rejects.toThrow(/ValidationError/);
    expect((await h.call(h.A, "me")).savedViews).toBeNull();
  });

  it("validates the default view the same way", async () => {
    await expect(h.call(h.A, "putProfile", { input: { defaultView: view({ who: "nobody" }) } })).rejects.toThrow(/ValidationError/);
    await h.call(h.A, "putProfile", { input: { defaultView: { id: "default", name: "Default", tags: [], who: "mine" } } });
    expect((await h.call(h.A, "me")).defaultView.who).toBe("mine");
  });
});
