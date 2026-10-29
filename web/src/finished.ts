import type { Item, Task } from "@aubi/shared";

/**
 * Finished Tasks (Status `done`), most recently done first. Done Archives a Task, so these are
 * off On track and Overdue; this list is how you reach one to see its History. Chores are never
 * finished, and an Item Archived by hand without a Completion isn't either.
 */
export function finishedTasks(items: Iterable<Item>): Task[] {
  return [...items]
    .filter((i): i is Task => i.kind === "task" && i.lastDoneAt !== undefined)
    .sort((a, b) => b.lastDoneAt! - a.lastDoneAt!);
}
