import { describe, expect, it } from "vitest";
import { DAY, type Item } from "@aubi/shared";
import { itemIdFromMessage } from "./deepLink";
import { openItem } from "./openItem";

const ME = "u-me";
const PARTNER = "u-partner";
const NOW = Date.UTC(2026, 9, 29, 18);

const chore = (over: Partial<Item> = {}): Item =>
  ({
    id: "c1", title: "Bins out", tags: [], visibility: "shared", archived: false, createdBy: ME, createdAt: NOW - 30 * DAY,
    updatedAt: NOW - DAY, version: 1, kind: "chore", recurrence: { type: "interval", every: 3, unit: "days" }, lastDoneAt: NOW - 4 * DAY,
    ...over,
  }) as Item;

describe("opening the item a Ding links to", () => {
  it("opens a red item with Done offered", () => {
    const item = chore();
    expect(openItem("c1", { c1: item }, ME, NOW)).toEqual({ item, canDone: true });
  });

  it("opens my Private item", () => {
    const item = chore({ visibility: `private:${ME}` });
    expect(openItem("c1", { c1: item }, ME, NOW)?.canDone).toBe(true);
  });

  it("refuses an unknown item", () => {
    expect(openItem("gone", { c1: chore() }, ME, NOW)).toBeUndefined();
  });

  // A stale cache can still hold an item the partner has since made Private.
  it("refuses an item that is Private to my partner", () => {
    expect(openItem("c1", { c1: chore({ visibility: `private:${PARTNER}` }) }, ME, NOW)).toBeUndefined();
  });

  it("opens a finished Task or an archived item without Done", () => {
    const task = { ...chore(), kind: "task", recurrence: undefined, dueAt: NOW - DAY, lastDoneAt: NOW - 1000, archived: true } as Item;
    expect(openItem("c1", { c1: task }, ME, NOW)).toEqual({ item: task, canDone: false });
    expect(openItem("c1", { c1: chore({ archived: true }) }, ME, NOW)?.canDone).toBe(false);
  });
});

describe("the worker's open-item message", () => {
  it("carries the item ID", () => {
    expect(itemIdFromMessage({ type: "openItem", itemId: "c1" })).toBe("c1");
  });

  it.each([[null], ["c1"], [{ type: "other", itemId: "c1" }], [{ type: "openItem" }], [{ type: "openItem", itemId: "" }]])(
    "ignores anything else (%j)",
    (data) => {
      expect(itemIdFromMessage(data)).toBeUndefined();
    },
  );
});
