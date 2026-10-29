import { beforeEach, describe, expect, it } from "vitest";
import { harness } from "./testing/harness";

const h = harness();

beforeEach(() => h.reset());

const task = (id: string, tags: string[], visibility = "shared") => ({
  id, kind: "task", title: id, tags, visibility, archived: false, recurrence: null,
});

const tag = (id: string, name: string, group: string) => ({ input: { id, name, group } });

const byId = (s: any) => Object.fromEntries(s.items.map((i: any) => [i.id, i]));

describe("deleteTag", () => {
  it("removes the Tag from every item that carried it and bumps those items' versions", async () => {
    await h.call(h.A, "putTag", tag("locale-kitchen", "Kitchen", "Locale"));
    await h.call(h.A, "putTag", tag("locale-nursery", "Nursery", "Locale"));
    await h.call(h.A, "putItem", { input: task("dishes", ["locale-kitchen", "locale-nursery"]) });
    await h.call(h.B, "putItem", { input: task("bottles", ["locale-kitchen"], `private:${h.B.userId}`) });
    await h.call(h.A, "putItem", { input: task("crib", ["locale-nursery"]) });

    await h.call(h.A, "deleteTag", { id: "locale-kitchen" });

    const a = byId(await h.call(h.A, "snapshot"));
    const b = byId(await h.call(h.B, "snapshot"));
    expect(a.dishes.tags).toEqual(["locale-nursery"]);
    expect(a.dishes.version).toBe(2);
    expect(b.bottles.tags).toEqual([]); // the partner's Private item is cleaned too
    expect(b.bottles.version).toBe(2);
    expect(a.crib.version).toBe(1); // untouched
  });
});

describe("Tag groups", () => {
  it("Category \"Kitchen\" and Locale \"Kitchen\" are two separate Tags", async () => {
    await h.call(h.A, "putTag", tag("category-kitchen", "Kitchen", "Category"));
    await h.call(h.A, "putTag", tag("locale-kitchen", "Kitchen", "Locale"));
    const tags = (await h.call(h.B, "snapshot")).tags.map((t: any) => `${t.group}/${t.name}/${t.id}`).sort();
    expect(tags).toEqual(["Category/Kitchen/category-kitchen", "Locale/Kitchen/locale-kitchen"]);
  });

  it("a Tag can't be moved into a different group by reusing its ID", async () => {
    await h.call(h.A, "putTag", tag("a-b-c", "c", "a-b"));
    await expect(h.call(h.B, "putTag", tag("a-b-c", "b c", "a"))).rejects.toThrow("ValidationError");
    expect((await h.call(h.A, "snapshot")).tags).toMatchObject([{ id: "a-b-c", name: "c", group: "a-b" }]);
  });

  it("a Tag can still be renamed within its group", async () => {
    await h.call(h.A, "putTag", tag("locale-kitchen", "Kitchen", "Locale"));
    await h.call(h.A, "putTag", tag("locale-kitchen", "Kitchenette", "Locale"));
    expect((await h.call(h.A, "snapshot")).tags).toMatchObject([{ id: "locale-kitchen", name: "Kitchenette" }]);
  });
});
