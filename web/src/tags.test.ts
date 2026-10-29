import { describe, expect, it } from "vitest";
import { chipLabel, liveTags, matchesTags, tagId } from "./tags";

const tag = (group: string, name: string) => ({ id: tagId(group, name), name, group, updatedAt: 0 });
const index = (...ts: ReturnType<typeof tag>[]) => Object.fromEntries(ts.map((t) => [t.id, t]));

const catKitchen = tag("Category", "Kitchen");
const locKitchen = tag("Locale", "Kitchen");
const nursery = tag("Locale", "Nursery");
const evening = tag("Time of day", "Evening");
const tags = index(catKitchen, locKitchen, nursery, evening);

describe("same-named Tags in different groups", () => {
  it("get different IDs", () => {
    expect(catKitchen.id).not.toBe(locKitchen.id);
  });

  it("filtering by one doesn't match an item that only has the other", () => {
    const item = { tags: [locKitchen.id] };
    expect(matchesTags(item, new Set([catKitchen.id]), tags)).toBe(false);
    expect(matchesTags(item, new Set([locKitchen.id]), tags)).toBe(true);
  });
});

describe("chipLabel", () => {
  it("shows the group only when another Tag has the same name", () => {
    expect(chipLabel(catKitchen, tags)).toBe("Kitchen · Category");
    expect(chipLabel(locKitchen, tags)).toBe("Kitchen · Locale");
    expect(chipLabel(nursery, tags)).toBe("Nursery");
  });

  it("treats names that differ only in case or spacing as a collision", () => {
    const t = index(tag("Category", "Kitchen"), tag("Locale", " kitchen"));
    expect(Object.values(t).map((x) => chipLabel(x, t)).sort()).toEqual([" kitchen · Locale", "Kitchen · Category"]);
  });
});

describe("filters", () => {
  it("OR within a group", () => {
    const sel = new Set([locKitchen.id, nursery.id]);
    expect(matchesTags({ tags: [nursery.id] }, sel, tags)).toBe(true);
    expect(matchesTags({ tags: [evening.id] }, sel, tags)).toBe(false);
  });

  it("AND across groups", () => {
    const sel = new Set([nursery.id, evening.id]);
    expect(matchesTags({ tags: [nursery.id, evening.id] }, sel, tags)).toBe(true);
    expect(matchesTags({ tags: [nursery.id] }, sel, tags)).toBe(false);
  });

  it("ignores selected Tags that no longer exist", () => {
    expect(matchesTags({ tags: [] }, new Set(["gone"]), tags)).toBe(true);
  });
});

describe("liveTags (before an outbox edit is sent)", () => {
  it("drops IDs of Tags deleted while the edit waited, so the server doesn't reject it", () => {
    expect(liveTags([nursery.id, "locale-garage", evening.id], tags)).toEqual([nursery.id, evening.id]);
  });
});
