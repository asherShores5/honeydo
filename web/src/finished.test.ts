import { describe, expect, it } from "vitest";
import type { Item } from "@aubi/shared";
import { finishedTasks } from "./finished";

const base = { tags: [] as string[], visibility: "shared" as const, createdBy: "a", createdAt: 0, updatedAt: 0, version: 1 };
const task = (id: string, extra: Partial<Item> = {}) => ({ ...base, id, title: id, kind: "task", archived: false, ...extra }) as Item;

describe("finishedTasks (Finished tab, the way into a finished Task's History)", () => {
  it("lists finished Tasks, most recently done first", () => {
    const items = [
      task("old", { archived: true, lastDoneAt: 100 }),
      task("new", { archived: true, lastDoneAt: 300 }),
      task("open"),
      task("archivedUndone", { archived: true }), // Archived by hand, never done
      { ...base, id: "bath", title: "Bath", kind: "chore", archived: false, lastDoneAt: 200,
        recurrence: { type: "interval", every: 3, unit: "days" } } as Item,
    ];
    expect(finishedTasks(items).map((i) => i.id)).toEqual(["new", "old"]);
  });
});
