// Service worker: offline app shell now; push and notification actions plug in below (M4 tickets 03-06).
// Built by the `serviceWorker` plugin in vite.config.ts into a single classic script at /sw.js, so
// it can import pure modules from src/ without becoming an ES-module worker.
/// <reference lib="webworker" />
import { routeRequest, shellCacheName, staleCaches } from "../src/swShell";

declare const self: ServiceWorkerGlobalScope;
/** Injected at build time: the build's content hash and the root paths to precache. */
declare const __SHELL_VERSION__: string;
declare const __PRECACHE__: string[];

const CACHE = shellCacheName(__SHELL_VERSION__);
/** A slow network is treated as no network after this long, so a dead zone with one bar still opens. */
const NAV_TIMEOUT_MS = 3000;

// ---- app shell -------------------------------------------------------------

self.addEventListener("install", (event) => {
  // Fetch the new shell into its own cache, bypassing the HTTP cache, then take over at once:
  // every asset name is content-hashed and index.html is versioned with them, so there's no
  // reason to keep an old worker around.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(__PRECACHE__.map((p) => new Request(p, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(staleCaches(keys, CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const route = routeRequest(event.request, self.location.origin, __PRECACHE__);
  if (route === "shell") event.respondWith(shell(event.request));
  else if (route === "precache") event.respondWith(precached(event.request));
  // "passthrough": no respondWith, the browser fetches as if there were no worker.
});

/** Network first so a new deploy shows up on the next launch; the cached index.html when offline or slow. */
async function shell(request: Request): Promise<Response> {
  const cached = () => caches.open(CACHE).then((c) => c.match("/index.html"));
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), NAV_TIMEOUT_MS)),
    ]);
    if (fresh.ok) return fresh;
    return (await cached()) ?? fresh;
  } catch (e) {
    const hit = await cached();
    if (hit) return hit;
    throw e;
  }
}

async function precached(request: Request): Promise<Response> {
  const hit = await caches.open(CACHE).then((c) => c.match(request, { ignoreSearch: true }));
  return hit ?? fetch(request);
}

// ---- push (ticket 03/04/06) --------------------------------------------------
// self.addEventListener("push", ...) goes here. Keep payload parsing in a pure module under src/.

// ---- notification actions (ticket 05) -----------------------------------------
// self.addEventListener("notificationclick", ...) goes here: focus/open the deep link, or run "Mark done".

export {};
