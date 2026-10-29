// Browser side of Ding deep links (m4/05): the item the app was asked to open, from `?item=` on
// load or from the service worker's message when an open app is tapped. Home consumes it.
// The pure rules are in deepLink.ts.
import { useSyncExternalStore } from "react";
import { itemIdFromMessage, itemIdFromUrl, withoutItemParam } from "./deepLink";

let pending: string | undefined;
const listeners = new Set<() => void>();

function setPending(id: string | undefined) {
  pending = id;
  listeners.forEach((l) => l());
}

/** Call once at startup, before the first render. */
export function startDeepLinks() {
  pending = itemIdFromUrl(location.href);
  navigator.serviceWorker?.addEventListener("message", (e: MessageEvent) => {
    const id = itemIdFromMessage(e.data);
    if (id) setPending(id);
  });
}

/** The item waiting to be opened, if any. */
export function usePendingItem(): string | undefined {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending,
  );
}

/** Mark the request handled and drop `?item=` from the address, so a reload doesn't reopen it. */
export function consumePendingItem() {
  if (itemIdFromUrl(location.href)) history.replaceState(history.state, "", withoutItemParam(location.href));
  setPending(undefined);
}
