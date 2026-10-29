// Outbox op types and the pure merge of a server snapshot with pending ops.
import type { Item } from "@aubi/shared";

export type ItemInput = Pick<Item, "id" | "kind" | "title" | "notes" | "tags" | "assigneeId" | "visibility" | "severity" | "recurrence" | "dueAt" | "warnWindow" | "snoozedUntil" | "archived">;

export type Op =
  | { id: string; type: "putItem"; input: ItemInput; expectedVersion?: number; changed: (keyof ItemInput)[] }
  | { id: string; type: "completeItem"; itemId: string; at: number; note?: string }
  | { id: string; type: "undoCompletion"; itemId: string; at: number };

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
