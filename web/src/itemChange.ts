import type { Item } from "@aubi/shared";

/** The ItemChange envelope, with its item already parsed. */
export interface ItemChange {
  item: Item;
  /** Members who just lost sight of the item (it went Private). They drop it. */
  removedFor?: string[] | null;
}

/** Fold one ItemChange (live or a mutation result) into the item map, as seen by `myId`. */
export function applyItemChange(items: Record<string, Item>, change: ItemChange, myId: string | undefined) {
  const { item } = change;
  if (myId && change.removedFor?.includes(myId)) {
    if (!(item.id in items)) return items;
    const { [item.id]: _gone, ...rest } = items;
    return rest;
  }
  const cur = items[item.id];
  if (cur && cur.version > item.version) return items; // stale echo
  return { ...items, [item.id]: item };
}
