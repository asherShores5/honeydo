// Guest demo mode: is this tab a demo, and keeping the demo's storage apart from a real Member's.
// The demo runs the same app on the same origin, so a Member who opens /demo in their own browser
// must keep their tokens, cache and outbox untouched. Every demo key gets a prefix instead.

const PREFIX = "demo:";
/** sessionStorage key that keeps this tab in the demo until Exit. Itself a demo key, so Exit clears it. */
export const DEMO_FLAG = "honeydo.demo";

/** sessionStorage key for the demo's table between reloads (see backend.ts). Reset removes it. */
export const DB_KEY = "honeydo.demo.db";

/** The demo's entry URL: /demo (CloudFront serves index.html for any path). */
export function demoRequested(href: string) {
  return /^\/demo\/?$/.test(new URL(href).pathname);
}

/** Whether this tab runs the demo: opened at /demo, or still flagged from earlier in this tab. Call before isolateStorage. */
export function demoActive(href: string, session: Pick<Storage, "getItem">) {
  return demoRequested(href) || session.getItem(PREFIX + DEMO_FLAG) === "1";
}

interface KeyedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** The unpatched removeItem of each prototype isolateStorage has patched. */
const rawRemove = new WeakMap<object, KeyedStorage["removeItem"]>();

/**
 * Prefix every getItem/setItem/removeItem on this Storage prototype (localStorage and
 * sessionStorage share Storage.prototype), so app code reads and writes only demo keys.
 * Returns a function that undoes the patch.
 */
export function isolateStorage(proto: Pick<KeyedStorage, "getItem" | "setItem" | "removeItem">) {
  const { getItem, setItem, removeItem } = proto;
  rawRemove.set(proto, removeItem);
  proto.getItem = function (k) { return getItem.call(this, PREFIX + k); };
  proto.setItem = function (k, v) { setItem.call(this, PREFIX + k, v); };
  proto.removeItem = function (k) { removeItem.call(this, PREFIX + k); };
  return () => {
    Object.assign(proto, { getItem, setItem, removeItem });
    rawRemove.delete(proto);
  };
}

/** Remove every demo key from `storage`, with or without the prefix patch on. */
export function clearDemoKeys(storage: KeyedStorage) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k?.startsWith(PREFIX)) keys.push(k);
  }
  let remove = storage.removeItem;
  for (let p = Object.getPrototypeOf(storage); p; p = Object.getPrototypeOf(p)) {
    const raw = rawRemove.get(p);
    if (raw) {
      remove = raw;
      break;
    }
  }
  for (const k of keys) remove.call(storage, k);
}
