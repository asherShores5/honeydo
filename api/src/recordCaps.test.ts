// Record caps against a scripted flood: generous enough that a household never meets them, but a
// loop calling the API can't grow the table without bound. Caps are seeded directly (fast).
import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();
const PK = "HH#aubi";

beforeEach(async () => {
  h.reset();
  await h.call(h.A, "me");
  await h.call(h.B, "me");
});

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: "task", title: `Task ${id}`, tags: [], visibility: "shared", archived: false, ...over,
});

function seedItems(n: number, archived = false, from = 0) {
  for (let i = from; i < from + n; i++) {
    h.db.seed({ PK, SK: `ITEM#seed-${i}`, ...task(`seed-${i}`, { archived }), createdBy: h.A.userId, createdAt: 1, updatedAt: 1, version: 1 });
  }
}

describe("items: at most 2000 in the household", () => {
  it("a new item past the cap is refused, archived ones included", async () => {
    seedItems(1000);
    seedItems(1000, true, 1000);
    await expect(h.call(h.B, "putItem", { input: task("new") })).rejects.toThrow(/ValidationError: .*2000 items/);
    expect(h.db.dump().some((r) => r.SK === "ITEM#new")).toBe(false);
  });

  it("editing an existing item at the cap still works", async () => {
    seedItems(2000);
    const c = await h.call(h.A, "putItem", { input: task("seed-7", { title: "Renamed" }) });
    expect(c.item.title).toBe("Renamed");
  });

  it("just under the cap a new item is fine", async () => {
    seedItems(1999);
    await expect(h.call(h.A, "putItem", { input: task("new") })).resolves.toMatchObject({ item: { id: "new" } });
  });
});

describe("Fridge Notes: at most 300", () => {
  const seedNotes = (n: number) => {
    for (let i = 0; i < n; i++) h.db.seed({ PK, SK: `NOTE#seed-${i}`, id: `seed-${i}`, text: "x", by: h.A.userId, at: 1, visibility: "shared", pinned: false, updatedAt: 1 });
  };

  it("a new Note past the cap is refused", async () => {
    seedNotes(300);
    await expect(h.call(h.A, "postNote", { id: "n1", text: "Out of diapers" })).rejects.toThrow(/ValidationError: .*300 Notes/);
  });

  it("a replay of a Note already posted still returns it at the cap", async () => {
    seedNotes(299);
    await h.call(h.A, "postNote", { id: "n1", text: "Out of diapers" });
    await expect(h.call(h.A, "postNote", { id: "n1", text: "Out of diapers" })).resolves.toMatchObject({ id: "n1" });
  });
});

describe("Comments: at most 500 per item", () => {
  const seedComments = (itemId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      h.db.seed({ PK, SK: `CMT#${itemId}#seed-${i}`, id: `seed-${i}`, itemId, at: 1, by: h.A.userId, text: "x", visibility: "shared" });
    }
  };

  it("a new Comment past the cap is refused; other items are unaffected", async () => {
    await h.call(h.A, "putItem", { input: task("t1") });
    await h.call(h.A, "putItem", { input: task("t2") });
    seedComments("t1", 500);
    await expect(h.call(h.B, "addComment", { itemId: "t1", id: "c1", text: "hi" })).rejects.toThrow(/ValidationError: .*500 Comments/);
    await expect(h.call(h.B, "addComment", { itemId: "t2", id: "c1", text: "hi" })).resolves.toMatchObject({ comment: { id: "c1" } });
  });

  it("a replay of a Comment already added still returns it at the cap", async () => {
    await h.call(h.A, "putItem", { input: task("t1") });
    seedComments("t1", 499);
    await h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "hi" });
    await expect(h.call(h.A, "addComment", { itemId: "t1", id: "c1", text: "hi" })).resolves.toMatchObject({ comment: { id: "c1" } });
  });
});
