import type { Item } from "@aubi/shared";

/** The ItemChange envelope, with its item already parsed. */
export interface ItemChange {
  item: Item;
  /** Members who just lost sight of the item (it went Private). They drop it. */
  removedFor?: string[] | null;
  /** `item` is a placeholder: only id, version and visibility are real. */
  redacted?: boolean | null;
}

export interface ApplyOptions {
  /** Called when the change is redacted and this Member still sees the item: fetch the real copy. */
  refresh?: () => void;
  /** This change is the result of a mutation this device sent (not a live echo). */
  ownResult?: boolean;
}

/** Fold one ItemChange (live or a mutation result) into the item map, as seen by `myId`. */
export function applyItemChange(
  items: Record<string, Item>,
  change: ItemChange,
  myId: string | undefined,
  opts: ApplyOptions = {},
) {
  const { item } = change;
  if (myId && change.removedFor?.includes(myId)) {
    if (!(item.id in items)) return items;
    const { [item.id]: _gone, ...rest } = items;
    return rest;
  }
  const cur = items[item.id];
  if (change.redacted) {
    // The device that made the edit already holds the content; it only needs the new version.
    if (opts.ownResult) {
      if (!cur || cur.version >= item.version) return items;
      return { ...items, [item.id]: { ...cur, version: item.version } };
    }
    opts.refresh?.();
    return items;
  }
  if (cur && cur.version > item.version) return items; // stale echo
  return { ...items, [item.id]: item };
}
