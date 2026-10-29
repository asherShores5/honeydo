// Which item a Ding's deep link opens, and whether it offers Done (m4/05). Pure; the URL and
// worker-message parsing is in deepLink.ts and the view is views/OpenedItem.tsx.
import { canSee, status, type Item, type UserId } from "@aubi/shared";

export interface OpenedItem {
  item: Item;
  /** False for a finished Task or an archived item: there is nothing left to mark done. */
  canDone: boolean;
}

/**
 * The item to open, or undefined if this Member can't see it: it was deleted, never synced, or
 * is another Member's Private item (a stale cache can still hold one).
 */
export function openItem(itemId: string, items: Readonly<Record<string, Item>>, me: UserId, now: number): OpenedItem | undefined {
  const item = items[itemId];
  if (!item || !canSee(item.visibility, me)) return undefined;
  return { item, canDone: !item.archived && status(item, now) !== "done" };
}
