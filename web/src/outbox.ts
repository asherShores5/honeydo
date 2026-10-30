// Outbox op types and the pure merge of a server snapshot with pending ops.
import type { Chore, Task } from "@aubi/shared";

type InputKey = "id" | "kind" | "title" | "notes" | "tags" | "assigneeId" | "visibility" | "severity" | "recurrence" | "dueAt" | "warnWindow" | "snoozedUntil" | "archived";
/** Per kind, so a Chore input can't drop its Recurrence. */
export type ItemInput = Pick<Chore, InputKey> | Pick<Task, InputKey>;

export type Op =
  | { id: string; type: "putItem"; input: ItemInput; expectedVersion?: number; changed: (keyof ItemInput)[] }
  | { id: string; type: "completeItem"; itemId: string; at: number; note?: string }
  | { id: string; type: "undoCompletion"; itemId: string; at: number }
  // m2/03: queued behind the new Task's putItem, so the server already has the Task. itemId = the Task.
  | { id: string; type: "markNoteTasked"; noteId: string; itemId: string };

export const opItemId = (op: Op) => (op.type === "putItem" ? op.input.id : op.itemId);

/**
 * Server snapshot, with the local optimistic copy kept for every item that still has an op in
 * the outbox (creates, edits and completions), so a refresh doesn't flash back or drop it.
 * `exceptItemId` takes that item from the server anyway, so a conflict replay reads the real server copy.
 */
export function keepPending<T>(server: Record<string, T>, local: Record<string, T>, outbox: Op[], exceptItemId?: string): Record<string, T> {
  const items = { ...server };
  for (const op of outbox) {
    const id = opItemId(op);
    if (id !== exceptItemId && local[id]) items[id] = local[id];
  }
  return items;
}
