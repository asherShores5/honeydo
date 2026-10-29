// Service worker: offline app shell, push notifications, and opening the app on a tapped Ding.
// Built by the `serviceWorker` plugin in vite.config.ts into a single classic script at /sw.js, so
// it can import pure modules from src/ without becoming an ES-module worker.
/// <reference lib="webworker" />
import { routeRequest, shellCacheName, staleCaches } from "../src/swShell";
import { clickPlan, notificationFor } from "../src/deepLink";

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

// ---- push (ticket 05; payloads from ticket 04/06) ----------------------------
// Always show a notification, even for an empty or broken payload: iOS revokes the subscription
// of a worker that receives a push and shows nothing. notificationFor never throws.
self.addEventListener("push", (event) => {
  let raw: string | undefined;
  try {
    raw = event.data?.text();
  } catch {
    raw = undefined;
  }
  const { title, options } = notificationFor(raw);
  event.waitUntil(self.registration.showNotification(title, options));
});

// ---- notification tap (ticket 05) --------------------------------------------
// iOS has no notification action buttons, so there is no "Mark done" here: a tap opens the app on
// the item and Done is one tap away there, through the app's normal outbox.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openFromNotification(event.notification.data));
});

async function openFromNotification(data: unknown): Promise<void> {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const plan = clickPlan(data, windows, self.location.origin);
  if ("open" in plan) {
    await self.clients.openWindow(plan.open);
    return;
  }
  const win = windows[plan.focus];
  // Post first: focus() can reject on some browsers if the tap's activation has lapsed, and the
  // app should still open the item when it next shows.
  if (plan.message) win.postMessage(plan.message);
  await win.focus().catch(() => undefined);
}

export {};
