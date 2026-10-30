// Ding deep links (m4/05): what the service worker shows for a push, where a tap goes, and how
// the app turns `?item=<id>` into an opened item. Pure, with no DOM or worker types, so both
// tsconfigs include it and vitest tests it directly. The glue is web/sw/sw.ts and openItem.ts.

const PARAM = "item";

/** The item a URL asks to open (`/?item=<id>`), if any. */
export function itemIdFromUrl(href: string): string | undefined {
  return new URL(href).searchParams.get(PARAM) || undefined;
}

/** The same URL as a path with `?item=` removed, for history.replaceState once the item is open. */
export function withoutItemParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(PARAM);
  return url.pathname + url.search + url.hash;
}

/** What the worker passes to showNotification. `data.url` is where a tap goes. */
export interface ShownNotification {
  title: string;
  options: { body: string; data: { url: string }; tag?: string; icon: string };
}

const ICON = "/icon-192.png";
const FALLBACK: ShownNotification = { title: "HoneyDo", options: { body: "Something needs you.", data: { url: "/" }, icon: ICON } };

/**
 * The notification for a push's text (a PushPayload from @aubi/shared notify.ts). Never throws
 * and always returns something to show: iOS revokes the subscription of a worker that receives a
 * push and shows nothing, so a missing or broken payload still gets a generic notification.
 * A Ding is tagged by item so a newer one replaces the old (where the browser supports tag).
 */
export function notificationFor(raw: string | undefined): ShownNotification {
  let p: unknown;
  try {
    p = raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return FALLBACK;
  }
  if (!isRecord(p) || typeof p.title !== "string" || !p.title) return FALLBACK;
  const data = isRecord(p.data) ? p.data : {};
  const url = typeof data.url === "string" ? data.url : "/";
  const shown: ShownNotification = {
    title: p.title,
    options: { body: typeof p.body === "string" ? p.body : "", data: { url }, icon: ICON },
  };
  if (data.kind === "ding" && typeof data.itemId === "string") shown.options.tag = `ding-${data.itemId}`;
  return shown;
}

/** The message the worker posts to an open app window: "open this item". */
export interface OpenItemMessage {
  type: "openItem";
  itemId: string;
}

/** The item an incoming worker message asks to open, if it is an OpenItemMessage. */
export function itemIdFromMessage(data: unknown): string | undefined {
  return isRecord(data) && data.type === "openItem" && typeof data.itemId === "string" && data.itemId ? data.itemId : undefined;
}

/** An app window as notificationclick sees it (a WindowClient's url and focused). */
export interface WindowLike {
  url: string;
  focused: boolean;
}

/**
 * What a tap does: focus an open app window (the focused one first) and, for an item link, tell
 * it which item to open; or, with no app window, open a new one on the link. The link always
 * stays on the app's origin; anything else falls back to the app's root.
 */
export type ClickPlan = { focus: number; message?: OpenItemMessage } | { open: string };

export function clickPlan(data: unknown, windows: readonly WindowLike[], origin: string): ClickPlan {
  const raw = isRecord(data) && typeof data.url === "string" ? data.url : "/";
  let target = new URL("/", origin);
  try {
    const u = new URL(raw, origin);
    if (u.origin === origin) target = u;
  } catch {
    // keep the root
  }
  const ours = windows.map((w, i) => ({ w, i })).filter(({ w }) => sameOrigin(w.url, origin));
  const pick = ours.find(({ w }) => w.focused) ?? ours[0];
  if (!pick) return { open: target.href };
  const itemId = itemIdFromUrl(target.href);
  return itemId ? { focus: pick.i, message: { type: "openItem", itemId } } : { focus: pick.i };
}

function sameOrigin(href: string, origin: string): boolean {
  try {
    return new URL(href).origin === origin;
  } catch {
    return false;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
