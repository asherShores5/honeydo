// Seam 2 for m5/05: Saved views live on each Member's own Profile, are validated by the server, and
// never reach the partner (own-only, like Activity last seen: their own mutation, nothing fans out).
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
beforeEach(() => h.reset());

const view = (over: Record<string, unknown> = {}) => ({
  id: "nursery", name: "Nursery evenings", tags: ["locale-nursery"], who: "anyone",
  sort: "urgency", layout: "list", pinned: true, ...over,
});
const save = (member: typeof h.A, savedViews: unknown) => h.call(member, "saveViews", { savedViews });

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

  it("never reach the partner's device: their snapshot carries none of mine", async () => {
    await save(h.A, [view()]);
    await h.call(h.A, "saveViews", { defaultView: { id: "default", name: "Default", tags: ["locale-nursery"], who: "mine" } });
    const snap = await h.call(h.B, "snapshot");
    const mine = snap.profiles.find((p: { userId: string }) => p.userId === h.A.userId);
    expect([mine.savedViews, mine.defaultView]).toEqual([null, null]);
  });

  it("can't be saved through putProfile, whose result fans out to the partner", async () => {
    await expect(h.call(h.A, "putProfile", { input: { savedViews: [view()] } })).rejects.toThrow(/ValidationError/);
    await expect(h.call(h.A, "putProfile", { input: { defaultView: view() } })).rejects.toThrow(/ValidationError/);
    await save(h.A, [view()]);
    const fannedOut = await h.call(h.A, "putProfile", { input: { displayName: "Asher" } });
    expect([fannedOut.savedViews, fannedOut.defaultView]).toEqual([null, null]);
  });

  it("saving one leaves the other alone", async () => {
    await save(h.A, [view()]);
    await h.call(h.A, "saveViews", { defaultView: { id: "default", name: "Default", tags: [], who: "mine" } });
    const me = await h.call(h.A, "me");
    expect([me.savedViews.length, me.defaultView.who]).toEqual([1, "mine"]);
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
    await expect(h.call(h.A, "saveViews", { defaultView: view({ who: "nobody" }) })).rejects.toThrow(/ValidationError/);
    await h.call(h.A, "saveViews", { defaultView: { id: "default", name: "Default", tags: [], who: "mine" } });
    expect((await h.call(h.A, "me")).defaultView.who).toBe("mine");
  });
});
