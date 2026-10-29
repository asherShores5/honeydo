import { describe, expect, it, vi } from "vitest";
import type { Item } from "@aubi/shared";
import { applyItemChange } from "./itemChange";

const ME = "sub-b";
const OWNER = "sub-a";

const item = (over: Partial<Item> = {}) =>
  ({
    id: "t1", kind: "task", title: "gift", tags: [], visibility: "shared", archived: false,
    createdBy: OWNER, createdAt: 1, updatedAt: 1, version: 1, ...over,
  }) as Item;

describe("applyItemChange (onItemChange and mutation results)", () => {
  it("drops the item when the change says I lost sight of it", () => {
    const items = { t1: item(), t2: item({ id: "t2" }) };
    const next = applyItemChange(
      items,
      { item: item({ visibility: `private:${OWNER}`, version: 2 }), removedFor: [ME] },
      ME,
    );
    expect(Object.keys(next)).toEqual(["t2"]);
  });

  it("keeps the item for the owner, updated to Private", () => {
    const items = { t1: item() };
    const next = applyItemChange(
      items,
      { item: item({ visibility: `private:${OWNER}`, version: 2 }), removedFor: [ME] },
      OWNER,
    );
    expect(next.t1.visibility).toBe(`private:${OWNER}`);
    expect(next.t1.version).toBe(2);
  });

  it("adds an item that just became shared as a normal change", () => {
    const next = applyItemChange({}, { item: item({ version: 2 }), removedFor: [] }, ME);
    expect(next.t1.title).toBe("gift");
  });

  it("ignores a stale echo", () => {
    const items = { t1: item({ version: 3, title: "new" }) };
    const next = applyItemChange(items, { item: item({ version: 2, title: "old" }) }, ME);
    expect(next.t1.title).toBe("new");
  });
});

describe("applyItemChange with a redacted change (an item just went Private)", () => {
  const placeholder = item({ title: "", visibility: `private:${OWNER}`, createdBy: "", createdAt: 0, updatedAt: 0, version: 2 });
  const redacted = { item: placeholder, removedFor: [ME], redacted: true };

  it("the partner drops the item and doesn't refresh", () => {
    const refresh = vi.fn();
    const next = applyItemChange({ t1: item() }, redacted, ME, { refresh });
    expect(next).toEqual({});
    expect(refresh).not.toHaveBeenCalled();
  });

  it("the owner's other devices refresh instead of storing the placeholder", () => {
    const refresh = vi.fn();
    const next = applyItemChange({ t1: item() }, redacted, OWNER, { refresh });
    expect(refresh).toHaveBeenCalledOnce();
    expect(next.t1.title).toBe("gift");
  });

  it("the device that made the edit keeps its local copy, at the new version", () => {
    const refresh = vi.fn();
    const local = item({ visibility: `private:${OWNER}`, version: 1 });
    const next = applyItemChange({ t1: local }, redacted, OWNER, { refresh, ownResult: true });
    expect(refresh).not.toHaveBeenCalled();
    expect(next.t1).toEqual({ ...local, version: 2 });
  });
});
